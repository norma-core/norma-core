import Long from 'long';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { readArduinoNiclaSenseMeMainValues, type Vec3 } from '@/devices/arduino-nicla-sense-me/values';

export interface RoverMotion {
  heading: number | null; // Magnetic bearing; undefined when the forward axis is vertical.
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
    || v.pitchDeg === null || v.rollDeg === null
    || ![v.pitchDeg,v.rollDeg].every(Number.isFinite)
    || !finiteVector(v.linearAccelG) || !finiteVector(v.gyroDps)) return null;
  // Undo the firmware's Euler-only half-turn (q * rot180x) first.
  const sensorRoll = ((v.rollDeg + 360) % 360 + 360) % 360 - 180;
  // Mounted rover calibration: positive corrected sensor roll = front up;
  // negative sensor pitch = left side down. The model uses positive pitch
  // for nose up and negative roll for left down.
  const pitch = sensorRoll;
  const roll = v.pitchDeg;
  // Mounted Nicla: +X right, +Y forward, +Z up. Rotate its +Y axis into
  // Bosch's East/North/Up world frame, then measure clockwise from north.
  // Using the forward vector handles combined pitch/roll without treating
  // the firmware's mathematical Euler yaw as a compass bearing.
  const norm = Math.hypot(v.quat.w, v.quat.x, v.quat.y, v.quat.z);
  const w = v.quat.w / norm, x = v.quat.x / norm;
  const y = v.quat.y / norm, z = v.quat.z / norm;
  const east = 2 * (x * y - w * z);
  const north = 1 - 2 * (x * x + z * z);
  const heading = Math.hypot(east, north) < 1e-6 ? null
    : (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  const toRoverFrame = (vector: Vec3): Vec3 => ({
    x: vector.y, y: vector.x === 0 ? 0 : -vector.x, z: vector.z,
  });
  return { heading, pitch, roll, accel: toRoverFrame(v.linearAccelG), gyro: toRoverFrame(v.gyroDps) };
}
