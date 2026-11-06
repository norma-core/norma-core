import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveElrobotJointNames, resolveElrobotUrdfPath } from './config';

describe('ElRobot config', () => {
  it('picks the URDF and joint names by role, sharing the seven arm joints', () => {
    expect(resolveElrobotUrdfPath(true)).toBe('devices/elrobot/elrobot_leader.urdf');
    expect(resolveElrobotUrdfPath(false)).toBe('devices/elrobot/elrobot_follower.urdf');
    expect(resolveElrobotUrdfPath(undefined)).toBe('devices/elrobot/elrobot_follower.urdf');

    const leader = resolveElrobotJointNames(true);
    const follower = resolveElrobotJointNames(false);
    expect(leader).toHaveLength(8);
    expect(follower).toHaveLength(8);
    expect(leader.slice(0, 7)).toEqual(follower.slice(0, 7));
    expect(leader[7]).toBe('trigger');
    expect(follower[7]).toEqual(['rev_motor_08', 'rev_motor_08_1', 'rev_motor_08_2']);
  });
});

describe('ElRobot leader URDF', () => {
  const urdfDir = path.resolve(__dirname, '../../../public/devices/elrobot');
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

  it('only re-parents motor 7 and replaces motor 8 with the trigger', () => {
    const followerJoint7 = byName(follower, 'joint').get('rev_motor_07')!;
    const leaderJoint7 = byName(leader, 'joint').get('rev_motor_07')!;
    expect(leaderJoint7.replace('Wrist_Roll_SO101_1', 'Gripper_Base_v1_1')).toBe(followerJoint7);
    expect(byName(leader, 'joint').has('trigger')).toBe(true);
    expect(byName(leader, 'joint').has('rev_motor_08')).toBe(false);
  });
});
