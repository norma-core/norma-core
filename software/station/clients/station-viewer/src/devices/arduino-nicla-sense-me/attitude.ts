import type { ArduinoNiclaSenseMeQuat, Vec3 } from './values';

/**
 * Orientation math for the Nicla Sense ME, computed in the viewer from the
 * raw BHY2 rotation vector. The firmware publishes only the quaternion; every
 * derived quantity (gravity, linear acceleration, roll/pitch/yaw, compass
 * heading) lives here so it can be recomputed on recorded data.
 *
 * Frames:
 *  - The BHY2 rotation vector is a body→world rotation with the Android
 *    convention: world is East/North/Up; body ("hub frame") is +X right,
 *    +Y forward, +Z up. On the rover the hub frame sits with +Y pointing
 *    forward (hardware-calibrated compass, see
 *    vesc-pwm-output-control/rover-motion.test.ts).
 *  - Roll/pitch/yaw follow ROS REP-103: body x forward, y left, z up;
 *    roll about x, pitch about y, yaw about z, right-hand positive, yaw 0 =
 *    east. Use `withMount` to express the quaternion in that body frame
 *    first; `displayAttitude` converts to the nose-up/right-down signs the
 *    dashboards show.
 *
 * All functions expect a unit quaternion (see `normalizeQuat`).
 */

export interface RollPitchYaw {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
}

export interface DisplayAttitude {
  /** Positive = front raised. */
  pitchNoseUpDeg: number;
  /** Positive = right side lowered. */
  rollRightDownDeg: number;
}

const DEG = 180 / Math.PI;
const SQRT_HALF = Math.SQRT1_2;

/** A body that is the hub frame itself (bare board). */
export const IDENTITY_MOUNT: ArduinoNiclaSenseMeQuat = { w: 1, x: 0, y: 0, z: 0 };

/**
 * Rotation taking rover-frame axes (x forward, y left, z up) to hub-frame
 * axes (+X right, +Y forward, +Z up): +90° about Z. Rover x = hub y,
 * rover y = −hub x.
 */
export const HUB_TO_ROVER: ArduinoNiclaSenseMeQuat = { w: SQRT_HALF, x: 0, y: 0, z: SQRT_HALF };

/**
 * Unit quaternion, or null when the registers are unpopulated (zeros before
 * the first BHY2 sample), wildly off-scale, or non-finite. A real rotation
 * vector is ~unit; the window tolerates float noise and sign flips.
 */
export function normalizeQuat(q: ArduinoNiclaSenseMeQuat | null | undefined): ArduinoNiclaSenseMeQuat | null {
  if (!q) {
    return null;
  }
  const norm = Math.hypot(q.w, q.x, q.y, q.z);
  if (!Number.isFinite(norm) || norm < 0.5 || norm > 1.5) {
    return null;
  }
  return { w: q.w / norm, x: q.x / norm, y: q.y / norm, z: q.z / norm };
}

/** Hamilton product a ⊗ b. */
export function quatMultiply(a: ArduinoNiclaSenseMeQuat, b: ArduinoNiclaSenseMeQuat): ArduinoNiclaSenseMeQuat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/**
 * Re-expresses a hub-frame body→world quaternion for a body whose axes are
 * `mount` relative to the hub (right-multiplication changes the body frame,
 * the world frame stays ENU).
 */
export function withMount(q: ArduinoNiclaSenseMeQuat, mount: ArduinoNiclaSenseMeQuat): ArduinoNiclaSenseMeQuat {
  return quatMultiply(q, mount);
}

/** World +Z (up) expressed in the body frame, in g. */
export function gravityBody(q: ArduinoNiclaSenseMeQuat): Vec3 {
  const { w, x, y, z } = q;
  return {
    x: 2 * (x * z - w * y),
    y: 2 * (y * z + w * x),
    z: w * w - x * x - y * y + z * z,
  };
}

/** Measured acceleration minus gravity, body frame, in g. */
export function linearAccelG(accelG: Vec3, q: ArduinoNiclaSenseMeQuat): Vec3 {
  const g = gravityBody(q);
  return { x: accelG.x - g.x, y: accelG.y - g.y, z: accelG.z - g.z };
}

/** REP-103 roll/pitch/yaw (ZYX Tait-Bryan) of a body→ENU quaternion. */
export function rpyRep103(q: ArduinoNiclaSenseMeQuat): RollPitchYaw {
  const { w, x, y, z } = q;
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  return {
    rollDeg: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
    pitchDeg: Math.asin(sinPitch) * DEG,
    yawDeg: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG,
  };
}

/**
 * Clockwise bearing of the body +X (forward) axis from north, 0–360, or null
 * when the forward axis is (near) vertical and the bearing is undefined.
 */
export function compassHeadingDeg(q: ArduinoNiclaSenseMeQuat): number | null {
  const { w, x, y, z } = q;
  const east = 1 - 2 * (y * y + z * z);
  const north = 2 * (x * y + w * z);
  if (Math.hypot(east, north) < 1e-6) {
    return null;
  }
  return (Math.atan2(east, north) * DEG + 360) % 360;
}

/** Dashboard signs: nose-up positive pitch, right-side-down positive roll. */
export function displayAttitude(rpy: RollPitchYaw): DisplayAttitude {
  return { pitchNoseUpDeg: 0 - rpy.pitchDeg, rollRightDownDeg: rpy.rollDeg };
}

/** Hub-frame vector (right, forward, up) → rover frame (forward, left, up). */
export function toRoverFrame(v: Vec3): Vec3 {
  return { x: v.y, y: 0 - v.x, z: v.z };
}
