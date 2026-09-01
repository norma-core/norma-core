import type { st3215 } from '@/api/proto.js';
import type { St3215Kinematics, St3215Model } from './define-model';

function createSt3215ModelCatalog(models: readonly St3215Model[]) {
  const modelsByMotorCount = new Map<number, St3215Model>();
  const modelIds = new Set<string>();

  for (const model of models) {
    if (!model.id) {
      throw new Error('ST3215 model id must not be empty.');
    }
    if (modelIds.has(model.id)) {
      throw new Error(`Duplicate ST3215 model id: ${model.id}`);
    }
    if (!Number.isInteger(model.motorCount) || model.motorCount <= 0) {
      throw new Error(`ST3215 model ${model.id} has an invalid motor count.`);
    }
    if (modelsByMotorCount.has(model.motorCount)) {
      throw new Error(
        `ST3215 motor count ${model.motorCount} is ambiguous; add an explicit model identity before registering another model with that count.`,
      );
    }

    modelIds.add(model.id);
    modelsByMotorCount.set(model.motorCount, model);
  }

  return {
    resolveBus(bus: st3215.InferenceState.IBusState): St3215Model | null {
      const model = modelsByMotorCount.get(bus.motors?.length ?? 0);
      return model?.supportsBus(bus) ? model : null;
    },
    resolveJointCount(jointCount: number): St3215Kinematics | null {
      const model = modelsByMotorCount.get(jointCount);
      return model?.supportsJointCount(jointCount) ? model.kinematics : null;
    },
  };
}

const st3215ModelEntries = import.meta.glob<{ default: St3215Model }>(
  '../*/st3215-model.ts',
  { eager: true },
);

const st3215ModelCatalog = createSt3215ModelCatalog(
  Object.values(st3215ModelEntries).map((entry) => entry.default),
);

export function resolveSt3215Model(
  bus: st3215.InferenceState.IBusState,
): St3215Model | null {
  return st3215ModelCatalog.resolveBus(bus);
}

export function supportsSt3215Bus(bus: st3215.InferenceState.IBusState): boolean {
  return resolveSt3215Model(bus) !== null;
}

export function resolveSt3215Kinematics(
  jointCount: number,
): St3215Kinematics | null {
  return st3215ModelCatalog.resolveJointCount(jointCount);
}
