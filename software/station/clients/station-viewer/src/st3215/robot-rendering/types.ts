import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { st3215 } from '@/api/proto.js';

export type RobotJointNames = (string | string[])[];

export interface BaseRobotRendererRef {
  toggleRangeSpheres: () => void;
}

export interface St3215RobotRendererProps {
  busSerialNumber: string | null | undefined;
  bus: st3215.InferenceState.IBusState;
  isLeader?: boolean;
}

export interface MotorMaterialContext {
  materialName: string;
  motorCount: number;
}

export interface JointValueContext {
  jointName: string;
  position: number;
  lowerLimit: number;
  upperLimit: number;
}

export type JointValueResolver = (context: JointValueContext) => number;
export type MotorMaterialResolver = (context: MotorMaterialContext) => number | null;

export interface BaseRobotRendererProps extends St3215RobotRendererProps {
  urdfPath: string;
  jointNames?: RobotJointNames;
  basePos?: [number, number, number];
  baseRpy?: [number, number, number];
  resolveMotorMaterialIndex?: MotorMaterialResolver;
  resolveJointValue?: JointValueResolver;
}

export type St3215RobotRendererComponent = ForwardRefExoticComponent<
  St3215RobotRendererProps & RefAttributes<BaseRobotRendererRef>
>;
