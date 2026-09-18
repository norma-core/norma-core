import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import {
  HUB_TO_ROVER,
  IDENTITY_MOUNT,
  compassHeadingDeg,
  displayAttitude,
  gravityBody,
  linearAccelG,
  normalizeQuat,
  rpyRep103,
  toRoverFrame,
  withMount,
} from './attitude';
import type { ArduinoNiclaSenseMeQuat } from './values';

const RAD = Math.PI / 180;

/**
 * Body→ENU rotation vector for a physical pose of the mounted board, in the
 * hub frame (+X right, +Y forward, +Z up): clockwise compass turn about
 * world Z, then nose-up about hub X, then right-side-down about hub Y. Same
 * construction as the hardware-calibrated compass tests in
 * vesc-pwm-output-control/rover-motion.test.ts.
 */
function pose(headingDeg: number, noseUpDeg = 0, rightDownDeg = 0): ArduinoNiclaSenseMeQuat {
  const q = new Quaternion().setFromEuler(
    new Euler(noseUpDeg * RAD, rightDownDeg * RAD, -headingDeg * RAD, 'ZXY'),
  );
  return { w: q.w, x: q.x, y: q.y, z: q.z };
}

function rover(headingDeg: number, noseUpDeg = 0, rightDownDeg = 0): ArduinoNiclaSenseMeQuat {
  return withMount(pose(headingDeg, noseUpDeg, rightDownDeg), HUB_TO_ROVER);
}

describe('normalizeQuat', () => {
  it('returns a unit quaternion for a usable rotation vector', () => {
    const q = normalizeQuat({ w: 1.2, x: 0, y: 0, z: 0 });
    expect(q).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    const flipped = normalizeQuat({ w: -0.6, x: 0, y: 0, z: -0.8 });
    expect(flipped?.w).toBeCloseTo(-0.6);
    expect(flipped?.z).toBeCloseTo(-0.8);
  });

  it('rejects unpopulated, wildly scaled or non-finite quaternions', () => {
    expect(normalizeQuat({ w: 0, x: 0, y: 0, z: 0 })).toBeNull();
    expect(normalizeQuat({ w: 0.3, x: 0, y: 0, z: 0 })).toBeNull();
    expect(normalizeQuat({ w: 3, x: 0, y: 0, z: 0 })).toBeNull();
    expect(normalizeQuat({ w: 1, x: NaN, y: 0, z: 0 })).toBeNull();
    expect(normalizeQuat(null)).toBeNull();
  });
});

describe('compassHeadingDeg', () => {
  it.each([0, 45, 90, 180, 270, 359])('reads %s° clockwise from north for a level rover', (heading) => {
    expect(compassHeadingDeg(rover(heading))).toBeCloseTo(heading);
  });

  it.each([[35, 25, -30], [120, -40, 20], [280, 50, 45]])(
    'keeps heading %s° under pitch %s° and roll %s°',
    (heading, noseUp, rightDown) => {
      expect(compassHeadingDeg(rover(heading, noseUp, rightDown))).toBeCloseTo(heading);
    },
  );

  it('matches the hardware-calibrated hub +Y azimuth for arbitrary rotations', () => {
    // Deterministic pseudo-random rotations.
    let seed = 7;
    const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      const hub = normalizeQuat({ w: rand(), x: rand(), y: rand(), z: rand() });
      if (!hub) {
        continue;
      }
      const east = 2 * (hub.x * hub.y - hub.w * hub.z);
      const north = 1 - 2 * (hub.x * hub.x + hub.z * hub.z);
      const reference = ((Math.atan2(east, north) / RAD) + 360) % 360;
      const actual = compassHeadingDeg(withMount(hub, HUB_TO_ROVER));
      expect(actual).not.toBeNull();
      const diff = Math.abs(((actual! - reference + 540) % 360) - 180);
      expect(diff).toBeCloseTo(0, 6);
    }
  });

  it('is undefined when the forward axis is vertical', () => {
    expect(compassHeadingDeg(rover(90, 90))).toBeNull();
  });

  it('reads the board-frame heading of hub +X for a bare board', () => {
    // Hub +X is right; a level board with hub +Y north has +X pointing east.
    expect(compassHeadingDeg(withMount(pose(0), IDENTITY_MOUNT))).toBeCloseTo(90);
  });
});

describe('rpyRep103', () => {
  it('reports yaw counterclockwise from east for a level rover', () => {
    expect(rpyRep103(rover(0)).yawDeg).toBeCloseTo(90); // facing north
    expect(rpyRep103(rover(90)).yawDeg).toBeCloseTo(0); // facing east
    expect(rpyRep103(rover(180)).yawDeg).toBeCloseTo(-90); // facing south
    expect(Math.abs(rpyRep103(rover(270)).yawDeg)).toBeCloseTo(180); // facing west
  });

  it('reports nose-up as negative pitch and right-side-down as positive roll', () => {
    const rpy = rpyRep103(rover(0, 20, 0));
    expect(rpy.pitchDeg).toBeCloseTo(-20);
    expect(rpy.rollDeg).toBeCloseTo(0);
    const lean = rpyRep103(rover(0, 0, 10));
    expect(lean.rollDeg).toBeCloseTo(10);
    expect(lean.pitchDeg).toBeCloseTo(0);
  });

  it('is level for the identity rotation', () => {
    const rpy = rpyRep103({ w: 1, x: 0, y: 0, z: 0 });
    expect(rpy.rollDeg).toBeCloseTo(0);
    expect(rpy.pitchDeg).toBeCloseTo(0);
    expect(rpy.yawDeg).toBeCloseTo(0);
  });
});

describe('displayAttitude', () => {
  it('shows nose-up and right-side-down as positive', () => {
    expect(displayAttitude(rpyRep103(rover(0, 20, 0))).pitchNoseUpDeg).toBeCloseTo(20);
    expect(displayAttitude(rpyRep103(rover(0, -5, 0))).pitchNoseUpDeg).toBeCloseTo(-5);
    expect(displayAttitude(rpyRep103(rover(0, 0, 10))).rollRightDownDeg).toBeCloseTo(10);
    expect(displayAttitude(rpyRep103(rover(0, 0, -10))).rollRightDownDeg).toBeCloseTo(-10);
  });
});

describe('gravity and linear acceleration', () => {
  it('puts gravity along +Z for a level board', () => {
    const g = gravityBody(pose(0));
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo(0);
    expect(g.z).toBeCloseTo(1);
  });

  it('puts gravity along the forward axis when the nose points straight up', () => {
    const g = gravityBody(pose(0, 90));
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo(1);
    expect(g.z).toBeCloseTo(0);
  });

  it('removes gravity from the measured acceleration', () => {
    const q = pose(30, 15, -10);
    const g = gravityBody(q);
    const rest = linearAccelG({ x: g.x, y: g.y, z: g.z }, q);
    expect(Math.hypot(rest.x, rest.y, rest.z)).toBeCloseTo(0);
    const moving = linearAccelG({ x: g.x + 0.2, y: g.y, z: g.z }, q);
    expect(moving.x).toBeCloseTo(0.2);
  });
});

describe('toRoverFrame', () => {
  it('maps hub right/forward/up to rover forward/left/up', () => {
    expect(toRoverFrame({ x: 1, y: 2, z: 3 })).toEqual({ x: 2, y: -1, z: 3 });
    expect(toRoverFrame({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});
