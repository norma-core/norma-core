import type { MotorMaterialContext } from '@/st3215/robot-rendering/types';

export const SO101_DEVICE_ID = 'so101';
export const SO101_MOTOR_COUNT = 6;

export function resolveSo101UrdfPath(isLeader?: boolean): string {
  return isLeader
    ? 'devices/so101/so101_robot_leader.urdf'
    : 'devices/so101/so101_robot_follower.urdf';
}

export const so101BasePos: [number, number, number] = [0.125, -0.03, -0.17];
export const so101BaseRpy: [number, number, number] = [-Math.PI / 2, 0, 0];
export const so101JointNames = ['1', '2', '3', '4', '5', '6'];

export function resolveSo101MotorMaterialIndex({
  materialName,
  motorCount,
}: MotorMaterialContext): number | null {
  if (!materialName.includes('sts3215')) {
    return null;
  }

  for (let index = 0; index < motorCount; index++) {
    if (materialName === `sts3215_03a_v1_${index + 1}_material`) {
      return index;
    }
  }

  return null;
}
