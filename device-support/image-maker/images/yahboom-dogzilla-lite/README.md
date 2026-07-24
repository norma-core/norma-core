# yahboom-dogzilla-lite image

A prebuilt golden image ships in this repo at
`images/yahboom-dogzilla-lite/golden-image.img`, so **stages 1–3 are optional** —
if you just want a flashable card, skip straight to stage 4 (needs only Docker).
Build your own golden image only when changing the station binary, drivers, or app.

Run all commands from the repository root.

```bash
make protobuf                                                                        # 1. generate protobufs    (build only)
make -C software/station/bin/station FEATURES=yahboom-dogzilla-lite build-arm64      # 2. cross-compile station (build only)
device-support/image-maker/image-maker build --image yahboom-dogzilla-lite           # 3. build golden image    (build only)
device-support/image-maker/image-maker customize --image yahboom-dogzilla-lite       # 4. write credentials -> final image
```

1. **Protobufs** — `pack.sh` copies generated Python protobufs from
   `target/gen_python/protobuf/…`; it fails fast if they are missing.
2. **Station binary** — the `FEATURES=yahboom-dogzilla-lite build-arm64` target
   builds with the device's drivers (pulls in `ov5647`) via `cargo-zigbuild`.
   Baked at `/opt/station/station`, read from
   `target/aarch64-unknown-linux-gnu/release/station` (override with
   `YAHBOOM_DOGZILLA_LITE_STATION_BINARY`).
3. **Golden image** — credential-free template written to
   `images/yahboom-dogzilla-lite/golden-image.img`, overwriting the prebuilt one.
4. **Customize** — copies the golden image, prompts for Wi-Fi / SSH / Tailscale
   credentials, and writes the final `target/images/yahboom-dogzilla-lite.img`.
   Needs only Docker. Use `IMAGE_*` env vars + `--non-interactive` to automate.

Flash the final image with Raspberry Pi Imager, balenaEtcher, or `dd`.

## Prerequisites

- **Docker** (with `buildx`); on non-arm64 hosts:
  `docker run --privileged --rm tonistiigi/binfmt --install all`.
- **Go** + **Python 3** for `make protobuf`.
- **Rust** with `cargo-zigbuild` (needs Zig) and the arm64 target:
  `rustup target add aarch64-unknown-linux-gnu`.

## Customization step (stage 4)

`customize` never touches the golden image — it works on a copy, injecting your
credentials into `/etc/firstboot.conf` on the ext4 root partition (unprivileged,
via `debugfs` — no mount, no loop device). On first boot,
`firstboot-setup.service` runs `firstboot.sh`, which reads that file to create the
SSH user, bring up Wi-Fi, and optionally join Tailscale, then deletes it so
credentials don't linger on the card.

### Selecting input / output

- `--image yahboom-dogzilla-lite` — shorthand: reads
  `images/yahboom-dogzilla-lite/golden-image.img`, writes
  `target/images/yahboom-dogzilla-lite.img`.
- `--input-image <img>` — read an explicit golden image instead (mutually
  exclusive with `--image`).
- `--output-image <img>` — write to an explicit path (defaults to
  `target/images/<input filename>`).

### Options

| Flag | Description |
| --- | --- |
| `-n, --image <name>` | Golden-in / final-out shorthand for `images/<name>/`. |
| `-i, --input-image <img>` | Golden image to read (instead of `--image`). |
| `-o, --output-image <img>` | Final image to write. |
| `--root-partition-number <n>` | ext4 root partition number (default `2`). |
| `--reset-firstboot` | Also clear `/etc/.firstboot_done` so a reused card re-provisions. |
| `--non-interactive` | Require credentials via env vars; never prompt. |
| `--force` | Overwrite the output image if it already exists. |

### Credentials

Prompted interactively, or supplied via environment variables (when all required
ones are set, prompts are skipped — pair with `--non-interactive` for CI):

```
IMAGE_WIFI_SSID, IMAGE_WIFI_PASSWORD, IMAGE_WIFI_COUNTRY   (required)
IMAGE_CUSTOM_USER, IMAGE_CUSTOM_USER_SSH_KEY               (required)
IMAGE_TAILSCALE_AUTH_KEY, IMAGE_TAILSCALE_AUTH_SERVER      (optional)
```

- **Wi-Fi** — SSID, password, and two-letter country code (country defaults from
  your host locale).
- **SSH user** — a passwordless, sudo-enabled login user plus its OpenSSH public
  key.
- **Tailscale** — auth key and login server; leave empty to skip.

Example (non-interactive):

```bash
IMAGE_WIFI_SSID=mynet IMAGE_WIFI_PASSWORD=secret IMAGE_WIFI_COUNTRY=US \
IMAGE_CUSTOM_USER=pilot IMAGE_CUSTOM_USER_SSH_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
device-support/image-maker/image-maker customize \
  --image yahboom-dogzilla-lite --non-interactive --force
```

See the [image-maker README](../../README.md) for how `build`/`customize` work.
