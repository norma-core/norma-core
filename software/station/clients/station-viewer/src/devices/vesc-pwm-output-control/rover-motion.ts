import Long from 'long';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { readArduinoNiclaSenseMeMainValues, type Vec3 } from '@/devices/arduino-nicla-sense-me/values';

export interface RoverMotion {
  heading: number;
  pitch: number;
  roll: number;
  accel: Vec3; // Body-frame linear acceleration in g, with gravity removed by firmware.
  gyro: Vec3;
}
export function readRoverMotion(envelope: me.IRxEnvelope | undefined, now: number): RoverMotion | null {
  if (!envelope || envelope.error || envelope.signalType !== me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_REGISTERS_SNAPSHOT || !envelope.monotonicStampNs) return null;
  const age = now - serverToLocal(Long.fromValue(envelope.monotonicStampNs)).toNumber() / 1e6;
  if (!Number.isFinite(age) || age < -1000 || age > 1500) return null;
  const v = readArduinoNiclaSenseMeMainValues(envelope.data);
  const finiteVector = (vec: Vec3 | null): vec is Vec3 => !!vec && [vec.x,vec.y,vec.z].every(Number.isFinite);
  if (((v.statusByte ?? 0) & 0x05) !== 0x05) return null;
  if (!v.quat || Math.hypot(v.quat.w,v.quat.x,v.quat.y,v.quat.z) > 1.5
    || v.headingDeg === null || v.pitchDeg === null || v.rollDeg === null
    || ![v.headingDeg,v.pitchDeg,v.rollDeg].every(Number.isFinite)
    || !finiteVector(v.linearAccelG) || !finiteVector(v.gyroDps)) return null;
  // Undo the firmware's Euler-only half-turn (q * rot180x) first.
  const sensorRoll = ((v.rollDeg + 360) % 360 + 360) % 360 - 180;
  // Mounted rover calibration: positive corrected sensor roll = front up;
  // negative sensor pitch = left side down. The model uses positive pitch
  // for nose up and negative roll for left down.
  const pitch = sensorRoll;
  const roll = v.pitchDeg;
  return { heading: ((v.headingDeg % 360) + 360) % 360, pitch, roll, accel: v.linearAccelG, gyro: v.gyroDps };
}
