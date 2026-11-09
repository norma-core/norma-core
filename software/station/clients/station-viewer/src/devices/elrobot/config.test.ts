import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BusRole } from '@/st3215/bus-role';
import { resolveElrobotJointNames, resolveElrobotUrdfPath } from './config';

const publicDir = path.resolve(__dirname, '../../../public');
const urdfDir = path.join(publicDir, 'devices/elrobot');

const byName = (xml: string, tag: 'joint' | 'link'): Map<string, string> => {
  const out = new Map<string, string>();
  const re = new RegExp(`<${tag} name="([^"]+)"[^>]*>[\\s\\S]*?</${tag}>`, 'g');
  for (const match of xml.matchAll(re)) {
    out.set(match[1], match[0].replace(/\s+/g, ' ').replace(/ \/>/g, '/>'));
  }
  return out;
};

const follower = readFileSync(path.join(urdfDir, 'elrobot_follower.urdf'), 'utf8');
const leader = readFileSync(path.join(urdfDir, 'elrobot_leader.urdf'), 'utf8');

describe('ElRobot config', () => {
  // A joint renamed in a URDF, or a URDF moved, would silently leave motors
  // unrendered: the renderer looks joints up by name and ignores misses.
  it.each<BusRole>(['leader', 'follower'])('names only joints that exist in the %s URDF', (role) => {
    const urdf = readFileSync(path.join(publicDir, resolveElrobotUrdfPath(role)), 'utf8');
    const joints = byName(urdf, 'joint');
    const configured = resolveElrobotJointNames(role).flat();
    expect(configured.length).toBeGreaterThan(0);
    for (const name of configured) {
      expect(joints.has(name), `${role} URDF has no joint "${name}"`).toBe(true);
    }
  });
});

describe('ElRobot leader URDF', () => {
  it('keeps motors 1-6, their rigid joints and links identical to the follower', () => {
    const followerJoints = byName(follower, 'joint');
    const leaderJoints = byName(leader, 'joint');
    const shared = [...followerJoints.keys()].filter((name) => name !== 'rev_motor_07' && !name.startsWith('rev_motor_08') && name !== 'Rigid 17');
    expect(shared).toEqual(['Rigid 1', 'rev_motor_01', 'Rigid 3', 'rev_motor_02', 'Rigid 7', 'rev_motor_03', 'Rigid 9', 'rev_motor_04', 'Rigid 11', 'rev_motor_05', 'Rigid 13', 'rev_motor_06', 'Rigid 15']);
    for (const name of shared) {
      expect(leaderJoints.get(name), name).toBe(followerJoints.get(name));
    }

    const followerLinks = byName(follower, 'link');
    const leaderLinks = byName(leader, 'link');
    for (const name of followerLinks.keys()) {
      if (leaderLinks.has(name)) {
        expect(leaderLinks.get(name), name).toBe(followerLinks.get(name));
      }
    }
    expect([...leaderLinks.keys()].filter((name) => !followerLinks.has(name))).toEqual(['Wrist_Roll_SO101_1', 'Trigger_SO101_1']);
  });

  it('keeps motor 7 in place but gives it the leader wrist-roll travel and child', () => {
    const followerJoint7 = byName(follower, 'joint').get('rev_motor_07')!;
    const leaderJoint7 = byName(leader, 'joint').get('rev_motor_07')!;
    const part = (joint: string, tag: string): string => joint.match(new RegExp(`<${tag} [^>]*/>`))![0];
    expect(part(leaderJoint7, 'origin')).toBe(part(followerJoint7, 'origin'));
    expect(part(leaderJoint7, 'axis')).toBe(part(followerJoint7, 'axis'));
    expect(part(leaderJoint7, 'parent')).toBe(part(followerJoint7, 'parent'));
    expect(part(leaderJoint7, 'child')).toBe('<child link="Wrist_Roll_SO101_1"/>');
    // The viewer maps the calibrated range onto these limits, so their span must
    // match the wrist roll's real travel: 3352 encoder steps between its stops.
    const limits = part(leaderJoint7, 'limit').match(/upper="([^"]+)" lower="([^"]+)"/)!;
    const spanDeg = ((Number(limits[1]) - Number(limits[2])) * 180) / Math.PI;
    expect(spanDeg).toBeCloseTo((3352 / 4096) * 360, 1);
    expect(byName(leader, 'joint').has('trigger')).toBe(true);
    expect(byName(leader, 'joint').has('rev_motor_08')).toBe(false);
  });
});
