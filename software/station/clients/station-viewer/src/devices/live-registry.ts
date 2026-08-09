import type { Frame } from '@/api/frame-parser';
import type {
  LiveDeviceAdapter,
  LiveDeviceContent,
  LiveDeviceSlot,
} from './live';

export interface ResolvedLiveDeviceView extends LiveDeviceContent {
  moduleId: string;
  moduleLabel: string;
  slot: LiveDeviceSlot;
}

export interface LiveDeviceError {
  moduleId: string;
  moduleLabel: string;
  message: string;
}

export interface LiveDevicePlan {
  views: readonly ResolvedLiveDeviceView[];
  errors: readonly LiveDeviceError[];
  isEmpty: boolean;
  hasRealtimeDevice: boolean;
  hasEmbeddedCameraFeed: boolean;
}

export interface LiveDeviceCatalog {
  resolve: (frame: Frame | null) => LiveDevicePlan;
}

function compareDevices(left: LiveDeviceAdapter, right: LiveDeviceAdapter): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

export function createLiveDeviceCatalog(
  adapters: readonly LiveDeviceAdapter[],
): LiveDeviceCatalog {
  const sortedAdapters = [...adapters].sort(compareDevices);
  const adapterIds = new Set<string>();

  for (const adapter of sortedAdapters) {
    if (!adapter.id) {
      throw new Error('Live device module id must not be empty.');
    }
    if (adapterIds.has(adapter.id)) {
      throw new Error(`Duplicate live device module id: ${adapter.id}`);
    }
    if (!Number.isFinite(adapter.order)) {
      throw new Error(`Live device module ${adapter.id} has an invalid order.`);
    }
    if (adapter.embedsCameraFeed && adapter.slot !== 'primary') {
      throw new Error(`Live device module ${adapter.id} can only embed cameras in the primary slot.`);
    }
    adapterIds.add(adapter.id);
  }

  return {
    resolve(frame) {
      if (!frame) {
        return {
          views: [],
          errors: [],
          isEmpty: true,
          hasRealtimeDevice: false,
          hasEmbeddedCameraFeed: false,
        };
      }

      const views: ResolvedLiveDeviceView[] = [];
      const errors: LiveDeviceError[] = [];
      let hasRealtimeDevice = false;
      let hasEmbeddedCameraFeed = false;

      for (const adapter of sortedAdapters) {
        try {
          const selected = [...adapter.resolve(frame)].sort((left, right) =>
            left.key.localeCompare(right.key),
          );
          const keys = new Set<string>();

          for (const view of selected) {
            if (!view.key) {
              throw new Error('A live device view key must not be empty.');
            }
            if (keys.has(view.key)) {
              throw new Error(`Duplicate live device view key: ${view.key}`);
            }
            keys.add(view.key);
          }

          for (const view of selected) {
            views.push({
              ...view,
              moduleId: adapter.id,
              moduleLabel: adapter.label,
              slot: adapter.slot,
            });
          }

          hasRealtimeDevice ||= adapter.isRealtime && selected.length > 0;
          hasEmbeddedCameraFeed ||= adapter.embedsCameraFeed && selected.length > 0;
        } catch (error) {
          errors.push({
            moduleId: adapter.id,
            moduleLabel: adapter.label,
            message: error instanceof Error ? error.message : 'Unknown module selection error.',
          });
        }
      }

      return {
        views,
        errors,
        isEmpty: views.length === 0 && errors.length === 0,
        hasRealtimeDevice,
        hasEmbeddedCameraFeed,
      };
    },
  };
}

const liveDeviceModuleEntries = import.meta.glob<{ default: LiveDeviceAdapter }>(
  './*/module.ts',
  { eager: true },
);

const liveDeviceCatalog = createLiveDeviceCatalog(
  Object.values(liveDeviceModuleEntries).map((entry) => entry.default),
);

export function resolveLiveDevices(frame: Frame | null): LiveDevicePlan {
  return liveDeviceCatalog.resolve(frame);
}
