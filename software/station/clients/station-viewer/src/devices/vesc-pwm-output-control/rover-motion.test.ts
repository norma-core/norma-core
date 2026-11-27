import Long from 'long';
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { readRoverMotion } from './rover-motion';

function sample(): me.IRxEnvelope {
  const data = new Uint8Array(168), v = new DataView(data.buffer);
  data[0] = 5;
  v.setFloat32(0x50,1,true);
  v.setFloat32(0x64,359,true); v.setFloat32(0x68,8,true); v.setFloat32(0x6c,175,true);
  [0.1,0.2,1].forEach((n,i) => v.setFloat32(0x14+i*4,n,true));
  [1,2,3].forEach((n,i) => v.setFloat32(0x20+i*4,n,true));
  return { signalType: me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_REGISTERS_SNAPSHOT,
    data, monotonicStampNs: Long.fromNumber(1e9) };
}
describe('rover motion validity', () => {
  it('shows front-up as nose-up pitch instead of sideways roll', () => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    view.setFloat32(0x68, 0, true);
    view.setFloat32(0x6c, -160, true); // Corrected sensor roll +20: front raised.
    expect(readRoverMotion(s, 1100)).toMatchObject({ pitch:20,roll:0 });
  });
  it.each([-20, 20])('maps sensor pitch %s to the matching left/right lean', (sensorPitch) => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    view.setFloat32(0x68, sensorPitch, true);
    view.setFloat32(0x6c, 180, true);
    expect(readRoverMotion(s, 1100)).toMatchObject({ pitch:0,roll:sensorPitch });
  });
  it('maps gravity-free acceleration and gyro from sensor right/forward/up to rover forward/left/up', () => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    [0.15, -0.25, 0.35].forEach((n, i) => view.setFloat32(0x38 + i * 4, n, true));
    const motion = readRoverMotion(s, 1100)!;
    expect(motion).toMatchObject({ heading:0,pitch:-5,roll:8,gyro:{x:2,y:-1,z:3} });
    expect(motion.accel.x).toBeCloseTo(-0.25);
    expect(motion.accel.y).toBeCloseTo(-0.15);
    expect(motion.accel.z).toBeCloseTo(0.35);
  });
  it.each([[0, 0, 1], [0, 0.6, 0.8]])('shows zero stationary acceleration with gravity along (%s, %s, %s)', (x, y, z) => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    [x, y, z].forEach((n, i) => view.setFloat32(0x14 + i * 4, n, true));
    expect(readRoverMotion(s, 1100)!.accel).toEqual({ x:0,y:0,z:0 });
  });
  it('removes the firmware half-turn and maps fore/aft tilt while preserving measured vectors', () => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    for (const [reported, expected] of [[-179, 1], [179, -1], [-180, 0], [180, 0], [135, -45], [-135, 45]]) {
      view.setFloat32(0x6c, reported, true);
      const motion = readRoverMotion(s, 1100)!;
      expect(motion.pitch).toBe(expected);
      expect(motion.roll).toBe(8);
      expect(motion.heading).toBe(0);
      expect(motion.accel.z).toBe(0);
      expect(motion.gyro).toEqual({ x: 2, y: -1, z: 3 });
    }
  });
  it('does not show cached event data, stale samples, invalid rotation or nonfinite axes as fresh attitude', () => {
    const s = sample();
    expect(readRoverMotion({...s,signalType:me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_CONNECTED},1100)).toBeNull();
    expect(readRoverMotion(s,3000)).toBeNull();
    const data = s.data!;
    data[0] = 1; expect(readRoverMotion(s,1100)).toBeNull(); data[0] = 5;
    new DataView(data.buffer).setFloat32(0x20,NaN,true); expect(readRoverMotion(s,1100)).toBeNull();
    expect(readRoverMotion({...sample(),data:new Uint8Array(100)},1100)).toBeNull();
  });
  it('rejects nonfinite gravity-compensated acceleration instead of falling back to raw acceleration', () => {
    const s = sample();
    new DataView(s.data!.buffer).setFloat32(0x38, NaN, true);
    expect(readRoverMotion(s, 1100)).toBeNull();
  });
});

function orientedSample(heading: number, pitch = 0, roll = 0, scale = 1): me.IRxEnvelope {
  const s = sample();
  // Physical poses: clockwise compass turn about ENU Z, then nose-up
  // around sensor X (right), then left-side-up around sensor Y (forward).
  const radians = Math.PI / 180;
  const q = new Quaternion().setFromEuler(new Euler(pitch * radians, roll * radians, -heading * radians, 'ZXY'));
  const view = new DataView(s.data!.buffer);
  [q.w, q.x, q.y, q.z].forEach((value, i) => view.setFloat32(0x50 + i * 4, value * scale, true));
  return s;
}

describe('rover magnetic compass', () => {
  it.each([0, 45, 90, 180, 270, 359])('reports clockwise heading %s from the mounted forward axis', (heading) => {
    expect(readRoverMotion(orientedSample(heading), 1100)!.heading).toBeCloseTo(heading);
  });
  it.each([[35, 25, -30], [120, -40, 20], [280, 50, 45]])('keeps heading %s with pitch %s and roll %s', (heading, pitch, roll) => {
    expect(readRoverMotion(orientedSample(heading, pitch, roll), 1100)!.heading).toBeCloseTo(heading);
  });
  it('normalizes scaled quaternions and treats opposite quaternion signs as the same orientation', () => {
    expect(readRoverMotion(orientedSample(120, 25, -30, 1.2), 1100)!.heading).toBeCloseTo(120);
    expect(readRoverMotion(orientedSample(120, 25, -30, -1), 1100)!.heading).toBeCloseTo(120);
  });
  it('keeps motion available but hides undefined bearing when the forward axis is vertical', () => {
    const motion = readRoverMotion(orientedSample(90, 90), 1100);
    expect(motion).not.toBeNull();
    expect(motion!.heading).toBeNull();
  });
});
