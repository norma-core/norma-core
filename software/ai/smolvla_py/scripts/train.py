"""Minimal SmolVLA fine-tune loop for the norma-core pick-and-place parquets.

Merges all parquets, computes stats over the full set, and fine-tunes
`lerobot/smolvla_base`. Validation is done on device, not here.

Run:
    uv run python scripts/train.py --steps 5000 --batch-size 26
"""

from __future__ import annotations

import argparse
import math
import time
from functools import partial
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from smolvla import SmolVLAPolicy
from smolvla.dataset import PickAndPlaceDataset, collate_samples
from smolvla.normalize import normalize_action, normalize_state
from smolvla.stats import compute_stats, save_stats


ROOT = Path(__file__).resolve().parent.parent
DATASETS = ROOT.parent / "datasets"
CKPT_DIR = ROOT / "checkpoints"
IMAGE_KEYS = ("observation.images.cam0", "observation.images.cam1")
STATE_DIM = 6
ACTION_DIM = 6

DEFAULT_PARQUETS = [DATASETS / "dataset.parquet"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--steps", type=int, default=5000)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--weight-decay", type=float, default=1e-10)
    p.add_argument("--warmup-steps", type=int, default=1000,
                   help="Nominal warmup steps; auto-scaled if --steps < --decay-steps.")
    p.add_argument("--decay-steps", type=int, default=30000,
                   help="Nominal cosine decay length; auto-scaled if --steps is shorter.")
    p.add_argument("--decay-lr", type=float, default=2.5e-6,
                   help="LR floor at end of cosine decay.")
    p.add_argument("--grad-clip", type=float, default=10.0)
    p.add_argument("--save-every", type=int, default=1000)
    p.add_argument("--log-every", type=int, default=20)
    p.add_argument("--num-workers", type=int, default=2)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--parquets",
        type=Path,
        nargs="+",
        default=DEFAULT_PARQUETS,
        help="Parquet files to merge.",
    )
    p.add_argument("--base-checkpoint", type=str, default="lerobot/smolvla_base")
    p.add_argument("--output", type=Path, default=CKPT_DIR / "run")
    return p.parse_args()


def make_loader(ds, batch_size: int, shuffle: bool, num_workers: int) -> DataLoader:
    return DataLoader(
        ds,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        collate_fn=partial(collate_samples, image_keys=IMAGE_KEYS),
        pin_memory=True,
        drop_last=shuffle,
        persistent_workers=num_workers > 0,
    )


def move_batch(batch: dict, device: torch.device) -> dict:
    return {
        k: (v.to(device, non_blocking=True) if isinstance(v, torch.Tensor) else v)
        for k, v in batch.items()
    }


def build_train_batch(batch: dict, policy, stats, device) -> dict:
    batch = move_batch(batch, device)
    batch["observation.state"] = normalize_state(batch["observation.state"], stats)
    batch["action"] = normalize_action(batch["action"], stats)
    tokens, mask = policy.tokenize_task(batch.pop("task"), device=device)
    batch["observation.language.tokens"] = tokens
    batch["observation.language.attention_mask"] = mask
    return batch


def lr_lambda(
    step: int,
    nominal_warmup: int,
    nominal_decay: int,
    total_steps: int,
    decay_lr: float,
    peak_lr: float,
) -> float:
    if total_steps < nominal_decay:
        scale = total_steps / nominal_decay
        warmup = max(int(nominal_warmup * scale), 1)
        decay = total_steps
    else:
        warmup = max(nominal_warmup, 1)
        decay = nominal_decay

    if step < warmup:
        return (step + 1) / warmup
    s = min(step - warmup, decay - warmup)
    cos = 0.5 * (1 + math.cos(math.pi * s / max(decay - warmup, 1)))
    alpha = decay_lr / peak_lr
    return (1 - alpha) * cos + alpha


def main() -> None:
    args = parse_args()
    torch.manual_seed(args.seed)

    if not torch.cuda.is_available():
        raise SystemExit("CUDA required.")
    device = torch.device("cuda")

    # Ampere/Ada perf flags — TF32 for residual FP32 matmuls and cuDNN autotune.
    # Cheap, always-safe wins; behaviour unchanged at the (allowed) precision.
    torch.set_float32_matmul_precision("high")
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True

    # BF16 mixed-precision autocast on GPUs that support it (Ampere+).
    # The model is already designed for it: smolvlm backbone loads as bf16 and
    # flow_matching upcasts the final head to float32 before the loss. On older
    # GPUs without bf16 (V100/T4/P100), this silently no-ops and we stay in fp32.
    use_bf16 = torch.cuda.is_bf16_supported()
    print(
        f"GPU: {torch.cuda.get_device_name(0)} | "
        f"bf16 autocast: {'on' if use_bf16 else 'off (GPU lacks bf16, using fp32)'}"
    )

    args.output.mkdir(parents=True, exist_ok=True)

    train_ds = PickAndPlaceDataset(args.parquets, image_keys=IMAGE_KEYS)
    print(f"episodes: {train_ds.total_episodes}  frames: {len(train_ds)}")

    stats = compute_stats(train_ds._state, train_ds._action)
    stats_path = args.output / "stats.safetensors"
    save_stats(stats, stats_path)
    print(f"\nstats saved → {stats_path}")
    for k, v in stats.items():
        print(f"  {k:12s}  {v.tolist()}")
    stats = {k: v.to(device) for k, v in stats.items()}

    # --- model ---
    print(f"\nLoading base checkpoint {args.base_checkpoint} ...")
    policy = SmolVLAPolicy.from_pretrained(
        args.base_checkpoint,
        config_overrides={
            "image_keys": list(IMAGE_KEYS),
            "state_dim": STATE_DIM,
            "action_dim": ACTION_DIM,
            "load_vlm_weights": False,
            "empty_cameras": 0,
        },
        strict=False,
    ).to(device)
    policy.train()

    trainable = [p for p in policy.parameters() if p.requires_grad]
    n_train = sum(p.numel() for p in trainable)
    n_total = sum(p.numel() for p in policy.parameters())
    print(f"trainable params: {n_train:,} / {n_total:,}  ({100*n_train/n_total:.1f}%)")

    opt = torch.optim.AdamW(
        trainable, lr=args.lr, betas=(0.9, 0.95), weight_decay=args.weight_decay,
        fused=True,
    )
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lr_lambda=partial(
            lr_lambda,
            nominal_warmup=args.warmup_steps,
            nominal_decay=args.decay_steps,
            total_steps=args.steps,
            decay_lr=args.decay_lr,
            peak_lr=args.lr,
        )
    )

    train_loader = make_loader(train_ds, args.batch_size, shuffle=True, num_workers=args.num_workers)
    print(f"train batches/epoch: {len(train_loader)}")

    step = 0
    t0 = time.time()
    running_loss = 0.0
    running_n = 0

    while step < args.steps:
        for raw_batch in train_loader:
            if step >= args.steps:
                break
            batch = build_train_batch(raw_batch, policy, stats, device)
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=use_bf16):
                loss, info = policy.forward(batch)

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, args.grad_clip)
            opt.step()
            sched.step()

            running_loss += info["loss"]
            running_n += 1

            if (step + 1) % args.log_every == 0:
                dt = time.time() - t0
                avg = running_loss / running_n
                lr = sched.get_last_lr()[0]
                print(f"step {step+1:>6}/{args.steps}  loss {avg:.4f}  lr {lr:.2e}  "
                      f"({(step+1) / max(dt, 1e-9):.2f} step/s)")
                running_loss, running_n = 0.0, 0

            if (step + 1) % args.save_every == 0:
                out = args.output / f"step-{step+1:06d}"
                policy.save_pretrained(out)
                (out / "stats.safetensors").write_bytes(stats_path.read_bytes())
                print(f"  [save]  {out}")

            step += 1

    final = args.output / "final"
    policy.save_pretrained(final)
    (final / "stats.safetensors").write_bytes(stats_path.read_bytes())
    print(f"\ndone — final checkpoint at {final}")


if __name__ == "__main__":
    main()
