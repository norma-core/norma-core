import type { ComponentType } from 'react';
import type { Frame, FrameEntry } from '@/api/frame-parser';
import type { motors_mirroring, st3215, usbvideo } from '@/api/proto.js';
import type {
  JointValueResolver,
  RobotJointNames,
  St3215RobotRendererComponent,
} from '@/st3215/robot-rendering/types';

export interface LiveDeviceContext {
  frame: Frame;
  videoSources: FrameEntry<usbvideo.IRxEnvelope>[];
  mirroringState?: motors_mirroring.IInferenceState;
}

export interface LiveDeviceView<Props> {
  key: string;
  label?: string;
  order?: number;
  placement?: 'full' | 'widget';
  tracksFrameRate?: boolean;
  props: Props;
}

export interface LiveDeviceSlot<Props> {
  select: (context: LiveDeviceContext) => LiveDeviceView<Props>[];
  loadView: () => Promise<{ default: ComponentType<Props> }>;
}

export interface DeviceModule<LiveProps = unknown> {
  id: string;
  label: string;
  order: number;
  live: LiveDeviceSlot<LiveProps>;
}

export interface SelectedLiveDeviceView<Props = unknown> {
  moduleId: string;
  moduleLabel: string;
  loadView: LiveDeviceSlot<Props>['loadView'];
  view: LiveDeviceView<Props>;
  order: number;
}

export interface St3215RobotModelModule {
  id: string;
  label: string;
  order: number;
  motorCount: number;
  matches: (bus: st3215.InferenceState.IBusState) => boolean;
  kinematics: St3215DeviceKinematicConfig;
  loadRenderer: () => Promise<{ default: St3215RobotRendererComponent }>;
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
