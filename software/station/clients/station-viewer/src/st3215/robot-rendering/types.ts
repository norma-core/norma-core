import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { st3215 } from '@/api/proto.js';
import type { BusRole } from '../bus-role';

export type RobotJointNames = (string | string[])[];

export interface BaseRobotRendererRef {
  toggleRangeSpheres: () => void;
}

/** What the renderer host needs: it decides the role itself. */
export interface St3215BusProps {
  busSerialNumber: string | null | undefined;
  bus: st3215.InferenceState.IBusState;
}

/** A device renderer mounts only once the host has resolved the role. */
export interface St3215RobotRendererProps extends St3215BusProps {
  role: BusRole;
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

export interface BaseRobotRendererProps extends St3215BusProps {
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
