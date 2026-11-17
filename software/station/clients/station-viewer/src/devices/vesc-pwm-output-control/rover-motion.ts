import Long from 'long';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import {
  HUB_TO_ROVER,
  displayAttitude,
  linearAccelG,
  rpyRep103,
  toRoverFrame,
  withMount,
} from '@/devices/arduino-nicla-sense-me/attitude';
import {
  ME_STATUS,
  decodeArduinoNiclaSenseMe,
  forwardHeadingDeg,
  headingAccuracy,
  type HeadingAccuracyLevel,
  type Vec3,
} from '@/devices/arduino-nicla-sense-me/values';

export interface RoverMotion {
  /**
   * Magnetic bearing, clockwise from north; null when the forward axis is
   * vertical, the magnetometer is still uncalibrated, or the hub has reported
   * no accuracy for it.
   */
  heading: number | null;
  /**
   * Hub-estimated heading error in degrees (rotation-vector accuracy);
   * null when the hub has not reported one yet (register still 0).
   */
  headingAccuracyDeg: number | null;
  /** Display tier of that estimate; null together with headingAccuracyDeg. */
  headingAccuracyLevel: HeadingAccuracyLevel | null;
  /**
   * True while the magnetometer is uncalibrated (accuracy ≈ π): the heading
   * is withheld for that reason rather than because the forward axis is
   * vertical.
   */
  headingUncalibrated: boolean;
  /** Degrees, positive = front raised. */
  pitch: number;
  /** Degrees, positive = right side lowered. */
  roll: number;
  /**
   * Rover-frame (forward, left, up) linear acceleration in g, gravity removed
   * here; null while the firmware has not read the accelerometer's range from
   * the hub (range register 0), because the counts cannot be scaled then.
   */
  accel: Vec3 | null;
  /** Rover-frame angular velocity in dps; null while the gyroscope's range is unknown. */
  gyro: Vec3 | null;
}

/**
 * Rover attitude from a Nicla Sense ME snapshot. The firmware publishes raw
 * counts and the rotation vector; scaling, gravity removal and the
 * hub→rover frame change all happen here (see
 * devices/arduino-nicla-sense-me/attitude.ts for the frame conventions).
 */
export function readRoverMotion(envelope: me.IRxEnvelope | undefined, now: number): RoverMotion | null {
  if (!envelope || envelope.error || envelope.signalType !== me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_REGISTERS_SNAPSHOT || !envelope.monotonicStampNs) return null;
  const age = now - serverToLocal(Long.fromValue(envelope.monotonicStampNs)).toNumber() / 1e6;
  if (!Number.isFinite(age) || age < -1000 || age > 1500) return null;
  const sample = decodeArduinoNiclaSenseMe(envelope.data);
  if (!sample || (sample.statusByte & ME_STATUS.bhy2Running) === 0) return null;
  // Attitude and heading need only the rotation vector. A range register the
  // firmware could not read yet costs the accel/gyro readings, not the HUD.
  if (!sample.quat) return null;
  const rover = withMount(sample.quat, HUB_TO_ROVER);
  const { pitchNoseUpDeg: pitch, rollRightDownDeg: roll } = displayAttitude(rpyRep103(rover));
  const accuracy = headingAccuracy(sample.quatAccuracyRad);
  const uncalibrated = accuracy?.uncalibrated ?? false;
  return {
    heading: forwardHeadingDeg(sample),
    headingAccuracyDeg: accuracy?.deg ?? null,
    headingAccuracyLevel: accuracy?.level ?? null,
    headingUncalibrated: uncalibrated,
    pitch,
    roll,
    accel: sample.accelG ? toRoverFrame(linearAccelG(sample.accelG, sample.quat)) : null,
    gyro: sample.gyroDps ? toRoverFrame(sample.gyroDps) : null,
  };
}
