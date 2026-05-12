"""Per-motor goal computation: leader position -> follower command.

For each motor pair (same id on leader and follower bus) we:
  1. Convert the leader's present position to a 0-100% within its calibrated arc.
  2. Project that percentage onto the follower's calibrated arc (with safety margin).
  3. Apply current-overload protection: if the follower drew too much current
     while moving, block further movement in that direction until the leader
     reverses course.
  4. Pick speed/accel proportional to the remaining travel distance.
"""

from dataclasses import dataclass, field
from enum import Enum

from config import MotorConfig


# Motor status register bit 0 = under-voltage. Common on leaders when their rail
# dips under load and not a real fault — mask it out before gating.
STATUS_VOLTAGE_BIT = 0x01


class Direction(Enum):
    POSITIVE = 1
    NEGATIVE = -1


@dataclass
class MotorState:
    """Snapshot of one motor extracted from a single inference frame."""
    present_position: int = 0
    target_position: int = 0
    range_min: int = 0
    range_max: int = 0
    error_status: int = 0
    current: int = 0
    goal_speed: int = 0
    goal_accel: int = 0


@dataclass
class ProtectionState:
    """Per-motor memory across teleop ticks: which direction is currently blocked."""
    blocked_direction: Direction | None = None
    previous_position: int = 0


@dataclass
class MotorCommand:
    """One follower-bus write the teleop loop wants to issue this tick."""
    motor_id: int
    speed: int | None = None
    accel: int | None = None
    goal: int | None = None


def get_steps_range(range_min: int, range_max: int, config: MotorConfig) -> int:
    """Width of the calibrated arc in encoder steps, accounting for wrap-around."""
    if range_max >= range_min:
        return range_max - range_min
    return (config.max_steps - range_min) + range_max


def normalize_position(
    position: int, range_min: int, range_max: int, config: MotorConfig,
) -> float:
    """Map a raw encoder position to a 0-100% within [range_min, range_max].

    Handles wrap-around arcs (where range_max < range_min, e.g. the arc spans
    the encoder's zero crossing). Out-of-range positions clamp to the nearest
    end. Returns 50% when the arc has zero width (uncalibrated).
    """
    range_size = get_steps_range(range_min, range_max, config)
    if range_size == 0:
        return 50.0

    if range_max >= range_min:
        if position < range_min:
            relative = 0
        elif position > range_max:
            relative = range_size
        else:
            relative = position - range_min
    else:
        # Wrap-around arc: valid region is [range_min, max_steps) U [0, range_max].
        if position >= range_min:
            relative = position - range_min
        elif position <= range_max:
            relative = (config.max_steps - range_min) + position
        else:
            # Outside the arc — clamp to whichever end is closer.
            dist_to_min = range_min - position
            dist_to_max = position - range_max
            relative = 0 if dist_to_min < dist_to_max else range_size

    pct = (relative / range_size) * 100.0
    return max(0.0, min(100.0, pct))


def shortest_distance(a: int, b: int, config: MotorConfig) -> int:
    """Shortest distance between two encoder positions, going either direction."""
    half = config.max_steps // 2
    d = abs(a - b)
    return config.max_steps - d if d > half else d


def speed_and_accel_for_distance(
    distance: int, config: MotorConfig,
) -> tuple[int, int]:
    """Pick speed/accel proportional to how far the follower has to travel."""
    share = distance / (config.max_steps / 2)
    speed = int(share * (config.max_speed - config.min_speed)) + config.min_speed
    accel = int(share * (config.max_accel - config.min_accel)) + config.min_accel
    return speed, accel


def compute_motor_command(
    motor_id: int,
    leader: MotorState,
    follower: MotorState,
    protection: ProtectionState,
    config: MotorConfig,
) -> MotorCommand | None:
    """Decide what to send to one follower motor for this tick.

    Returns None when no command is needed (deadband, stale data, etc.).
    Mutates `protection` to remember the direction tracking across ticks.
    """
    # Skip if leader has a real fault (voltage dips don't count).
    if (leader.error_status & ~STATUS_VOLTAGE_BIT) != 0:
        return None

    # Zero positions usually mean the motor hasn't reported yet.
    if leader.present_position == 0 or follower.present_position == 0:
        return None

    # Need enough room on the follower's arc to apply the safety margin.
    follower_range = get_steps_range(follower.range_min, follower.range_max, config)
    if follower_range < config.safety_margin * 2:
        return None
    usable_range = follower_range - config.safety_margin * 2

    # Map leader's position to follower's coordinate system.
    leader_pct = normalize_position(
        leader.present_position, leader.range_min, leader.range_max, config,
    )
    goal_offset = int(leader_pct / 100.0 * usable_range) + config.safety_margin
    goal_position = (follower.range_min + goal_offset) % config.max_steps

    # What direction is the leader asking for?
    if goal_position > follower.present_position:
        leader_direction: Direction | None = Direction.POSITIVE
    elif goal_position < follower.present_position:
        leader_direction = Direction.NEGATIVE
    else:
        leader_direction = None

    threshold = config.get_current_threshold(motor_id)
    if threshold > 0:
        if follower.current >= threshold:
            # Current is high. Figure out which direction caused it (by comparing
            # to the previous tick's position) and block that direction.
            if (
                protection.blocked_direction is None
                and protection.previous_position != follower.present_position
            ):
                if follower.present_position > protection.previous_position:
                    protection.blocked_direction = Direction.POSITIVE
                else:
                    protection.blocked_direction = Direction.NEGATIVE

            # Hold position while current is elevated. Only re-issue the goal
            # if the follower is meaningfully off its current target.
            if abs(follower.target_position - follower.present_position) > config.deadband:
                return MotorCommand(motor_id=motor_id, goal=follower.present_position)
            return None

        # Current is back to normal. Clear the block only if the leader is now
        # asking for movement in the opposite direction (the original cause is
        # likely still mechanically present).
        if (
            protection.blocked_direction is not None
            and leader_direction is not None
            and leader_direction != protection.blocked_direction
        ):
            protection.blocked_direction = None

    # Leader still wants to push into the blocked direction — refuse.
    if protection.blocked_direction is not None:
        if leader_direction is None or leader_direction == protection.blocked_direction:
            protection.previous_position = follower.present_position
            return None

    distance = shortest_distance(follower.present_position, goal_position, config)

    # Already close enough — don't send anything.
    if distance <= config.deadband:
        return None
    if abs(follower.target_position - goal_position) <= config.deadband:
        return None

    cmd = MotorCommand(motor_id=motor_id, goal=goal_position)

    # Only emit speed/accel when they would actually change.
    speed, accel = speed_and_accel_for_distance(distance, config)
    if speed != follower.goal_speed:
        cmd.speed = speed
    if accel != follower.goal_accel:
        cmd.accel = accel

    protection.previous_position = follower.present_position
    return cmd


@dataclass
class ProtectionTable:
    """Persistent protection state for every follower motor we've seen."""
    states: dict[int, ProtectionState] = field(default_factory=dict)

    def get(self, motor_id: int) -> ProtectionState:
        if motor_id not in self.states:
            self.states[motor_id] = ProtectionState()
        return self.states[motor_id]
