import Long from 'long';
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { arduino_nicla_sense_me as me } from '@/api/proto.js';
import { gravityBody } from '@/devices/arduino-nicla-sense-me/attitude';
import { ME_OFFSETS, ME_REGISTER_LENGTH, ME_REVISION } from '@/devices/arduino-nicla-sense-me/values';
import { readRoverMotion } from './rover-motion';

const RAD = Math.PI / 180;
const ACCEL_RANGE_G = 16;
const GYRO_RANGE_DPS = 2000;
const ACCEL_COUNTS_PER_G = 32768 / ACCEL_RANGE_G;

function writeVec3i16(view: DataView, offset: number, x: number, y: number, z: number): void {
  view.setInt16(offset, Math.round(x), true);
  view.setInt16(offset + 2, Math.round(y), true);
  view.setInt16(offset + 4, Math.round(z), true);
}

function writeQuat(view: DataView, q: { w: number; x: number; y: number; z: number }, scale = 1): void {
  [q.w, q.x, q.y, q.z].forEach((value, i) => view.setFloat32(ME_OFFSETS.quat + i * 4, value * scale, true));
}

/**
 * Hub-frame rotation vector for a physical pose: clockwise compass turn about
 * ENU Z, then nose-up around sensor X (right), then right-side-down around
 * sensor Y (forward).
 */
function poseQuat(heading: number, noseUp = 0, rightDown = 0): Quaternion {
  return new Quaternion().setFromEuler(new Euler(noseUp * RAD, rightDown * RAD, -heading * RAD, 'ZXY'));
}

/** Rev-6 snapshot of a level board facing north, at rest, gyro (1000, 500, -250) dps in hub axes. */
function sample(): me.IRxEnvelope {
  const data = new Uint8Array(ME_REGISTER_LENGTH);
  const view = new DataView(data.buffer);
  data[ME_OFFSETS.status] = 0x01;
  data[ME_OFFSETS.softwareRevision] = ME_REVISION;
  view.setUint16(ME_OFFSETS.accelRangeG, ACCEL_RANGE_G, true);
  view.setUint16(ME_OFFSETS.gyroRangeDps, GYRO_RANGE_DPS, true);
  view.setUint16(ME_OFFSETS.magLsbPerUt, 16, true);
  writeVec3i16(view, ME_OFFSETS.accelRaw, 0, 0, ACCEL_COUNTS_PER_G);
  writeVec3i16(view, ME_OFFSETS.gyroRaw, 16384, 8192, -4096);
  writeQuat(view, poseQuat(0));
  return {
    signalType: me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_REGISTERS_SNAPSHOT,
    data,
    monotonicStampNs: Long.fromNumber(1e9),
  };
}

/** Sample posed physically, with the accelerometer reading exactly gravity. */
function orientedSample(heading: number, noseUp = 0, rightDown = 0, scale = 1): me.IRxEnvelope {
  const s = sample();
  const view = new DataView(s.data!.buffer);
  const q = poseQuat(heading, noseUp, rightDown);
  writeQuat(view, q, scale);
  const g = gravityBody({ w: q.w, x: q.x, y: q.y, z: q.z });
  writeVec3i16(view, ME_OFFSETS.accelRaw, g.x * ACCEL_COUNTS_PER_G, g.y * ACCEL_COUNTS_PER_G, g.z * ACCEL_COUNTS_PER_G);
  return s;
}

describe('rover attitude', () => {
  it('is level for a level board', () => {
    const motion = readRoverMotion(sample(), 1100)!;
    expect(motion.pitch).toBeCloseTo(0);
    expect(motion.roll).toBeCloseTo(0);
  });

  it.each([20, -5])('shows nose-up %s° as positive pitch without sideways roll', (noseUp) => {
    const motion = readRoverMotion(orientedSample(0, noseUp), 1100)!;
    expect(motion.pitch).toBeCloseTo(noseUp);
    expect(motion.roll).toBeCloseTo(0);
  });

  it.each([-20, 20])('shows right-side-down %s° as positive roll without pitch', (rightDown) => {
    const motion = readRoverMotion(orientedSample(0, 0, rightDown), 1100)!;
    expect(motion.roll).toBeCloseTo(rightDown);
    expect(motion.pitch).toBeCloseTo(0);
  });
});

describe('rover vectors', () => {
  it('maps gyro from sensor right/forward/up to rover forward/left/up', () => {
    const motion = readRoverMotion(sample(), 1100)!;
    expect(motion.gyro.x).toBeCloseTo(500);
    expect(motion.gyro.y).toBeCloseTo(-1000);
    expect(motion.gyro.z).toBeCloseTo(-250);
  });

  it.each([[0, 0, 0], [35, 25, -30], [280, 50, 45]])(
    'shows zero acceleration at rest for heading %s, pitch %s, roll %s',
    (heading, noseUp, rightDown) => {
      const motion = readRoverMotion(orientedSample(heading, noseUp, rightDown), 1100)!;
      expect(Math.hypot(motion.accel.x, motion.accel.y, motion.accel.z)).toBeCloseTo(0, 2);
    },
  );

  it('removes gravity in the viewer and reports a forward push as rover +x', () => {
    const s = sample();
    const view = new DataView(s.data!.buffer);
    // Level board: gravity on hub +Z, push of 0.25 g along hub +Y (forward).
    writeVec3i16(view, ME_OFFSETS.accelRaw, 0, 0.25 * ACCEL_COUNTS_PER_G, ACCEL_COUNTS_PER_G);
    const motion = readRoverMotion(s, 1100)!;
    expect(motion.accel.x).toBeCloseTo(0.25);
    expect(motion.accel.y).toBeCloseTo(0);
    expect(motion.accel.z).toBeCloseTo(0);
  });
});

describe('rover motion validity', () => {
  it('does not show cached event data, stale samples or short buffers as fresh attitude', () => {
    const s = sample();
    expect(readRoverMotion({ ...s, signalType: me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_CONNECTED }, 1100)).toBeNull();
    expect(readRoverMotion(s, 3000)).toBeNull();
    expect(readRoverMotion({ ...sample(), data: new Uint8Array(100) }, 1100)).toBeNull();
    expect(readRoverMotion(undefined, 1100)).toBeNull();
  });

  it('requires a running sensor hub and a usable rotation vector', () => {
    const s = sample();
    const data = s.data!;
    data[ME_OFFSETS.status] = 0;
    expect(readRoverMotion(s, 1100)).toBeNull();
    data[ME_OFFSETS.status] = 1;
    expect(readRoverMotion(s, 1100)).not.toBeNull();
    writeQuat(new DataView(data.buffer), { w: 0, x: 0, y: 0, z: 0 });
    expect(readRoverMotion(s, 1100)).toBeNull();
  });

  it('rejects images from another firmware revision', () => {
    const s = sample();
    s.data![ME_OFFSETS.softwareRevision] = 5;
    expect(readRoverMotion(s, 1100)).toBeNull();
  });

  it('rejects images whose range registers are unusable', () => {
    const s = sample();
    new DataView(s.data!.buffer).setUint16(ME_OFFSETS.accelRangeG, 0, true);
    expect(readRoverMotion(s, 1100)).toBeNull();
  });
});

describe('rover heading accuracy', () => {
  it('reports the hub heading error in degrees next to the heading', () => {
    const s = sample();
    new DataView(s.data!.buffer).setFloat32(ME_OFFSETS.quat + 16, 0.2, true);
    const motion = readRoverMotion(s, 1100)!;
    expect(motion.heading).toBeCloseTo(0);
    expect(motion.headingAccuracyDeg).toBeCloseTo(11.46, 1);
  });

  it('hides the heading but keeps attitude while the magnetometer is uncalibrated (accuracy ≈ π)', () => {
    const s = orientedSample(90, 10, 0);
    new DataView(s.data!.buffer).setFloat32(ME_OFFSETS.quat + 16, Math.PI, true);
    const motion = readRoverMotion(s, 1100)!;
    expect(motion.heading).toBeNull();
    expect(motion.headingAccuracyDeg).toBeCloseTo(180, 0);
    expect(motion.pitch).toBeCloseTo(10);
  });

  it('treats an accuracy of zero as unknown rather than perfect', () => {
    const motion = readRoverMotion(sample(), 1100)!; // register left at 0 by sample()
    expect(motion.headingAccuracyDeg).toBeNull();
    expect(motion.heading).toBeCloseTo(0);
  });
});

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
