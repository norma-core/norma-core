import Long from 'long';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import {
  HUB_TO_ROVER,
  compassHeadingDeg,
  displayAttitude,
  linearAccelG,
  rpyRep103,
  toRoverFrame,
  withMount,
} from '@/devices/arduino-nicla-sense-me/attitude';
import {
  ME_STATUS,
  decodeArduinoNiclaSenseMe,
  headingAccuracy,
  type Vec3,
} from '@/devices/arduino-nicla-sense-me/values';

export interface RoverMotion {
  /**
   * Magnetic bearing, clockwise from north; null when the forward axis is
   * vertical or the magnetometer is still uncalibrated.
   */
  heading: number | null;
  /**
   * Hub-estimated heading error in degrees (rotation-vector accuracy);
   * null when the hub has not reported one yet (register still 0).
   */
  headingAccuracyDeg: number | null;
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
  /** Rover-frame (forward, left, up) linear acceleration in g, gravity removed here. */
  accel: Vec3;
  /** Rover-frame angular velocity in dps. */
  gyro: Vec3;
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
  if (!sample.quat || !sample.accelG || !sample.gyroDps) return null;
  const rover = withMount(sample.quat, HUB_TO_ROVER);
  const { pitchNoseUpDeg: pitch, rollRightDownDeg: roll } = displayAttitude(rpyRep103(rover));
  const accuracy = headingAccuracy(sample.quatAccuracyRad);
  const uncalibrated = accuracy?.uncalibrated ?? false;
  return {
    heading: uncalibrated ? null : compassHeadingDeg(rover),
    headingAccuracyDeg: accuracy?.deg ?? null,
    headingUncalibrated: uncalibrated,
    pitch,
    roll,
    accel: toRoverFrame(linearAccelG(sample.accelG, sample.quat)),
    gyro: toRoverFrame(sample.gyroDps),
  };
}
