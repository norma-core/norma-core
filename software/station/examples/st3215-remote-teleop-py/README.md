# ST3215 Remote Teleop

Mirror motor positions from a leader ST3215 bus onto a follower bus across two stations.

## Run

```bash
# Two stations
uv run python main.py \
    --leader-server   localhost      --leader-bus   5AB9068903 \
    --follower-server ab-rpi5.server --follower-bus 5AB9068471

# Two stations, single bus on each side
uv run python main.py \
    --leader-server   localhost      --leader-bus   auto \
    --follower-server ab-rpi5.server --follower-bus auto
```

## Flags

| Flag                | Required | Notes                                                |
| ------------------- | -------- | ---------------------------------------------------- |
| `--leader-server`   | yes      | Station hostname for the leader bus.                 |
| `--leader-bus`      | no       | Bus serial, or `auto` (default) for a single-bus station. |
| `--follower-server` | yes      | Station hostname for the follower bus.               |
| `--follower-bus`    | no       | Bus serial, or `auto` (default).                     |

## What you'll see

Once a second the loop logs per-bus health:

```
leader@localhost:        freq=20.0 Hz age avg=12.4ms min=4.2ms max=27.0ms
follower@ab-rpi5.server: freq=20.0  Hz age avg=58.1ms min=43.0ms max=98.0ms
```

- **freq**: inference frames received in the last second.
- **age**: time between frame arrival and when the loop sampled it
  (only counted when the frame index advanced).

A bus that pauses prints `(no new frames)`.

## Stop

Ctrl+C. The follower torque is disabled on exit so the arm goes limp; remove
the `set_torque(..., enable=False)` block at the bottom of `main.py` if you
want it to hold its last commanded position.
