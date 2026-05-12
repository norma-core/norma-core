import type {
  JointValueContext,
  MotorMaterialContext,
  RobotJointNames,
} from '@/st3215/robot-rendering/types';

export const ELROBOT_DEVICE_ID = 'elrobot';
export const ELROBOT_MOTOR_COUNT = 8;
export const elrobotUrdfPath = 'devices/elrobot/elrobot_follower.urdf';
export const elrobotBasePos: [number, number, number] = [0, 0, 0];
export const elrobotBaseRpy: [number, number, number] = [-Math.PI / 2, 0, -Math.PI / 2];

export const elrobotJointNames: RobotJointNames = [
  'rev_motor_01',
  'rev_motor_02',
  'rev_motor_03',
  'rev_motor_04',
  'rev_motor_05',
  'rev_motor_06',
  'rev_motor_07',
  ['rev_motor_08', 'rev_motor_08_1', 'rev_motor_08_2'],
];

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
