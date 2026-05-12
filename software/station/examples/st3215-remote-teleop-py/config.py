"""Teleop tuning constants and per-motor config."""

from dataclasses import dataclass, field

# How often to recompute follower goals from the latest leader state.
TELEOP_REFRESH_INTERVAL_S = 0.020  # 50 Hz

# Inference data older than this is considered stale and skipped.
MAX_DATA_AGE_NS = 100_000_000  # 100 ms


@dataclass
class MotorConfig:
    """Per-motor tuning shared across all motors on the follower bus."""

    # Ignore movement smaller than this many encoder steps. Stops the follower
    # from twitching when the leader is "still" but jittering by 1-2 ticks.
    deadband: int = 20

    # Pad each end of the follower's calibrated arc by this much, so we never
    # command the follower into a hard stop.
    safety_margin: int = 20

    # Distance-proportional speed/accel envelope. The further the follower has
    # to travel, the faster it goes.
    min_speed: int = 300
    max_speed: int = 3300
    min_accel: int = 5
    max_accel: int = 100

    # Encoder resolution (4096 for ST3215).
    max_steps: int = 4096

    # Default current threshold (raw units). When the follower's measured
    # current exceeds this, freeze the goal at the present position to prevent
    # overload. 0 disables protection.
    current_threshold: int = 100

    # Per-motor overrides for current_threshold. Keyed by motor id.
    per_motor_current_threshold: dict[int, int] = field(default_factory=dict)

    def get_current_threshold(self, motor_id: int) -> int:
        return self.per_motor_current_threshold.get(motor_id, self.current_threshold)
