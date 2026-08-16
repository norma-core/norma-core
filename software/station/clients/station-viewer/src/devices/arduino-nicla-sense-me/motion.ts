import type { Vec3 } from './values';

export const MOTION_SAMPLE_SIZE = 19;
export const ACCEL_LSB_PER_G = 4096;
export const GYRO_LSB_PER_DPS = 16.384;
export const MAG_LSB_PER_UT = 16;

export interface MotionBatch {
  count: number;
  dropped: number;
  firstMillis: number;
  accel: Vec3[];
  gyro: Vec3[];
  mag: Vec3[];
}

/**
 * Parses a 100Hz motion batch blob drained from the device: a fixed 8-byte
 * header (count/dropped u16 LE, firstMillis u32 LE) followed by count
 * fixed-size samples (dt u8, then i16 LE accel/gyro/mag triples). Values are
 * converted from raw LSBs to SI units (g / dps / µT).
 */
export function parseMotionBatch(bytes: Uint8Array | null | undefined): MotionBatch | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, true);
  const dropped = view.getUint16(2, true);
  const firstMillis = view.getUint32(4, true);
  if (bytes.length !== 8 + count * MOTION_SAMPLE_SIZE) {
    return null;
  }
  const accel: Vec3[] = [];
  const gyro: Vec3[] = [];
  const mag: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const base = 8 + i * MOTION_SAMPLE_SIZE;
    const i16 = (offset: number) => view.getInt16(base + offset, true);
    accel.push({ x: i16(1) / ACCEL_LSB_PER_G, y: i16(3) / ACCEL_LSB_PER_G, z: i16(5) / ACCEL_LSB_PER_G });
    gyro.push({ x: i16(7) / GYRO_LSB_PER_DPS, y: i16(9) / GYRO_LSB_PER_DPS, z: i16(11) / GYRO_LSB_PER_DPS });
    mag.push({ x: i16(13) / MAG_LSB_PER_UT, y: i16(15) / MAG_LSB_PER_UT, z: i16(17) / MAG_LSB_PER_UT });
  }
  return { count, dropped, firstMillis, accel, gyro, mag };
}
