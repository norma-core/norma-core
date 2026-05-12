import type { st3215 } from '@/api/proto.js';
import {
  ELROBOT_DEVICE_ID,
  ELROBOT_MOTOR_COUNT,
  elrobotBasePos,
  elrobotBaseRpy,
  elrobotJointNames,
  elrobotUrdfPath,
  resolveElrobotJointValue,
} from './elrobot/config';
import {
  SO101_DEVICE_ID,
  SO101_MOTOR_COUNT,
  resolveSo101UrdfPath,
  so101BasePos,
  so101BaseRpy,
  so101JointNames,
} from './so101/config';
import type { St3215DeviceDefinition, St3215DeviceKinematicConfig } from './types';

// Motor-count matching is the current transport-level heuristic. Definition
// order is meaningful while multiple devices can share a motor count; replace
// or refine this when inference state exposes an explicit device/model id.
const matchesMotorCount =
  (motorCount: number) =>
    (bus: st3215.InferenceState.IBusState): boolean =>
      (bus.motors?.length ?? 0) === motorCount;

export const deviceDefinitions: St3215DeviceDefinition[] = [
  {
    id: SO101_DEVICE_ID,
    label: 'SO101',
    protocol: 'st3215',
    motorCount: SO101_MOTOR_COUNT,
    matches: matchesMotorCount(SO101_MOTOR_COUNT),
    load: () => import('./so101'),
  },
  {
    id: ELROBOT_DEVICE_ID,
    label: 'ElRobot',
    protocol: 'st3215',
    motorCount: ELROBOT_MOTOR_COUNT,
    matches: matchesMotorCount(ELROBOT_MOTOR_COUNT),
    load: () => import('./elrobot'),
  },
];

// Normvla rendering receives normalized joints rather than an ST3215 bus, so it
// needs eager kinematic config while device renderers stay lazy-loaded.
const deviceKinematicConfigs: St3215DeviceKinematicConfig[] = [
  {
    id: SO101_DEVICE_ID,
    label: 'SO101',
    motorCount: SO101_MOTOR_COUNT,
    urdfPath: resolveSo101UrdfPath(false),
    basePos: so101BasePos,
    baseRpy: so101BaseRpy,
    jointNames: so101JointNames,
  },
  {
    id: ELROBOT_DEVICE_ID,
    label: 'ElRobot',
    motorCount: ELROBOT_MOTOR_COUNT,
    urdfPath: elrobotUrdfPath,
    basePos: elrobotBasePos,
    baseRpy: elrobotBaseRpy,
    jointNames: elrobotJointNames,
    resolveJointValue: resolveElrobotJointValue,
  },
];

export const defaultSt3215DeviceKinematicConfig = deviceKinematicConfigs[0];

export function findSt3215DeviceDefinition(
  bus: st3215.InferenceState.IBusState,
): St3215DeviceDefinition | null {
  return deviceDefinitions.find((definition) => definition.matches(bus)) ?? null;
}

export function findSt3215DeviceKinematicConfig(
  motorCount: number,
): St3215DeviceKinematicConfig | null {
  return deviceKinematicConfigs.find((config) => config.motorCount === motorCount) ?? null;
}

export function supportsSt3215Device(bus: st3215.InferenceState.IBusState): boolean {
  return findSt3215DeviceDefinition(bus) !== null;
}
