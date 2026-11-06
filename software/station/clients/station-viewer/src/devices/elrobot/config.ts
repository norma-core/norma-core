import type {
  JointValueContext,
  MotorMaterialContext,
  RobotJointNames,
} from '@/st3215/robot-rendering/types';

export const ELROBOT_DEVICE_ID = 'elrobot';
export const ELROBOT_MOTOR_COUNT = 8;

// The follower is the upstream URDF (hardware/elrobot/simulation). The leader
// keeps joints 1-7 and swaps the gripper for the SO101 wrist roll, handle and
// trigger mounted on the motor 7 horn, with motor 8 driving the trigger.
export function resolveElrobotUrdfPath(isLeader?: boolean): string {
  return isLeader
    ? 'devices/elrobot/elrobot_leader.urdf'
    : 'devices/elrobot/elrobot_follower.urdf';
}

export const elrobotBasePos: [number, number, number] = [0, 0, 0];
export const elrobotBaseRpy: [number, number, number] = [-Math.PI / 2, 0, -Math.PI / 2];

const ELROBOT_ARM_JOINT_NAMES = [
  'rev_motor_01',
  'rev_motor_02',
  'rev_motor_03',
  'rev_motor_04',
  'rev_motor_05',
  'rev_motor_06',
  'rev_motor_07',
];

export const elrobotFollowerJointNames: RobotJointNames = [
  ...ELROBOT_ARM_JOINT_NAMES,
  ['rev_motor_08', 'rev_motor_08_1', 'rev_motor_08_2'],
];

// The trigger is a plain joint: the calibrated minimum maps to the lower limit
// (trigger against the grip) and the maximum to the upper (released), as the
// SO101 leader's trigger does.
export const elrobotLeaderJointNames: RobotJointNames = [...ELROBOT_ARM_JOINT_NAMES, 'trigger'];

export function resolveElrobotJointNames(isLeader?: boolean): RobotJointNames {
  return isLeader ? elrobotLeaderJointNames : elrobotFollowerJointNames;
}

export function resolveElrobotMotorMaterialIndex({
  materialName,
  motorCount,
}: MotorMaterialContext): number | null {
  const motorIndex = Number.parseInt(materialName.split('_')[1], 10) - 1;

  if (Number.isNaN(motorIndex) || motorIndex < 0 || motorIndex >= motorCount) {
    return null;
  }

  return motorIndex;
}

export function resolveElrobotJointValue({
  jointName,
  position,
  lowerLimit,
  upperLimit,
}: JointValueContext): number {
  const jointPosition = lowerLimit + position * (upperLimit - lowerLimit);
  return jointName.endsWith('_1') ? jointPosition : upperLimit - jointPosition;
}
