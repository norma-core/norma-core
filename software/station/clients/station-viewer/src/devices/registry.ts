import type { Frame } from '@/api/frame-parser';
import type { st3215 } from '@/api/proto.js';
import type {
  DeviceModule,
  LiveDeviceContext,
  SelectedLiveDeviceView,
  St3215DeviceKinematicConfig,
  St3215RobotModelModule,
} from './types';

const deviceModuleEntries = import.meta.glob<{ default: DeviceModule }>(
  './*/module.ts',
  { eager: true },
);

export const deviceModules = Object.values(deviceModuleEntries)
  .map((entry) => entry.default)
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const st3215RobotModelEntries = import.meta.glob<{ default: St3215RobotModelModule }>(
  './*/st3215-model.ts',
  { eager: true },
);

export const st3215RobotModels = Object.values(st3215RobotModelEntries)
  .map((entry) => entry.default)
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

export const defaultSt3215DeviceKinematicConfig: St3215DeviceKinematicConfig =
  st3215RobotModels[0].kinematics;

export function selectLiveDeviceViews(frame: Frame | null): SelectedLiveDeviceView[] {
  if (!frame) {
    return [];
  }

  const context: LiveDeviceContext = {
    frame,
    videoSources: frame.videoQueues ?? [],
    mirroringState: frame.mirroring?.data.state ?? undefined,
  };

  return deviceModules.flatMap((module) => {
    const live = module.live;
    if (!live) {
      return [];
    }

    return live.select(context).map((view) => ({
      moduleId: module.id,
      moduleLabel: module.label,
      loadView: live.loadView,
      view,
      order: view.order ?? module.order,
    }));
  }).sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.moduleId.localeCompare(right.moduleId) || left.view.key.localeCompare(right.view.key);
  });
}

export function findSt3215DeviceDefinition(
  bus: st3215.InferenceState.IBusState,
): St3215RobotModelModule | null {
  return st3215RobotModels.find((definition) => definition.matches(bus)) ?? null;
}

export function findSt3215DeviceKinematicConfig(
  motorCount: number,
): St3215DeviceKinematicConfig | null {
  return st3215RobotModels.find((config) => config.motorCount === motorCount)?.kinematics ?? null;
}

export function supportsSt3215Device(bus: st3215.InferenceState.IBusState): boolean {
  return findSt3215DeviceDefinition(bus) !== null;
}
