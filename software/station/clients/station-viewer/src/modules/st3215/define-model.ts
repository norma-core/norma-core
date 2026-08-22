import type { st3215 } from '@/api/proto.js';
import type {
  JointValueResolver,
  RobotJointNames,
  St3215RobotRendererComponent,
} from '@/modules/st3215/robot-rendering/types';

export interface St3215Kinematics {
  urdfPath: string;
  basePos: [number, number, number];
  baseRpy: [number, number, number];
  jointNames: RobotJointNames;
  resolveJointValue?: JointValueResolver;
}

export interface St3215Model {
  id: string;
  label: string;
  motorCount: number;
  kinematics: St3215Kinematics;
  loadRenderer: () => Promise<{ default: St3215RobotRendererComponent }>;
  supportsBus: (bus: st3215.InferenceState.IBusState) => boolean;
  supportsJointCount: (jointCount: number) => boolean;
}

interface St3215ModelDefinition {
  id: string;
  label: string;
  motorCount: number;
  kinematics: St3215Kinematics;
  loadRenderer: St3215Model['loadRenderer'];
  matchesBus?: (bus: st3215.InferenceState.IBusState) => boolean;
}

export function st3215Model(definition: St3215ModelDefinition): St3215Model {
  return {
    id: definition.id,
    label: definition.label,
    motorCount: definition.motorCount,
    kinematics: definition.kinematics,
    loadRenderer: definition.loadRenderer,
    supportsBus: (bus) =>
      (bus.motors?.length ?? 0) === definition.motorCount
      && (definition.matchesBus?.(bus) ?? true),
    supportsJointCount: (jointCount) => jointCount === definition.motorCount,
  };
}
