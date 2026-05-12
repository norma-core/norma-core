import type { st3215 } from '@/api/proto.js';
import type {
  JointValueResolver,
  RobotJointNames,
  St3215RobotRendererComponent,
} from '@/st3215/robot-rendering/types';

export interface St3215DeviceDefinition {
  id: string;
  label: string;
  protocol: 'st3215';
  motorCount: number;
  matches: (bus: st3215.InferenceState.IBusState) => boolean;
  load: () => Promise<{ default: St3215RobotRendererComponent }>;
}

export interface St3215DeviceKinematicConfig {
  id: string;
  label: string;
  motorCount: number;
  urdfPath: string;
  basePos: [number, number, number];
  baseRpy: [number, number, number];
  jointNames: RobotJointNames;
  resolveJointValue?: JointValueResolver;
}

export type DeviceDefinition = St3215DeviceDefinition;
