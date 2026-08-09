import type { drivers } from '@/api/proto.js';
import type { AnyDeviceQueueAdapter } from './queue-adapter';

export type QueueAdapterResolution =
  | { readonly adapter: AnyDeviceQueueAdapter }
  | { readonly ambiguous: readonly AnyDeviceQueueAdapter[] }
  | undefined;

export interface QueueAdapterRegistry {
  all(): readonly AnyDeviceQueueAdapter[];
  resolve(queueType: drivers.QueueDataType, queueId: string): QueueAdapterResolution;
}

export function createQueueAdapterRegistry(
  adapters: readonly AnyDeviceQueueAdapter[],
): QueueAdapterRegistry {
  const sorted = [...adapters].sort((left, right) => left.key.localeCompare(right.key));
  const keys = new Set<string>();
  const adaptersByType = new Map<drivers.QueueDataType, AnyDeviceQueueAdapter[]>();

  for (const adapter of sorted) {
    if (keys.has(adapter.key)) {
      throw new Error(`Duplicate device queue adapter key: ${adapter.key}`);
    }
    keys.add(adapter.key);

    const sameType = adaptersByType.get(adapter.queueType) ?? [];
    sameType.push(adapter);
    adaptersByType.set(adapter.queueType, sameType);
  }

  for (const [queueType, sameType] of adaptersByType) {
    const bare = sameType.filter((adapter) => !adapter.matchQueue);
    if (bare.length > 1) {
      throw new Error(`Multiple bare device queue adapters for queue type ${queueType}.`);
    }
  }

  return {
    all: () => sorted,
    resolve(queueType, queueId) {
      const sameType = adaptersByType.get(queueType) ?? [];
      const specific = sameType.filter((adapter) => adapter.matchQueue?.(queueId) === true);

      if (specific.length > 1) {
        return { ambiguous: specific };
      }
      if (specific.length === 1) {
        return { adapter: specific[0] };
      }

      const bare = sameType.find((adapter) => !adapter.matchQueue);
      return bare ? { adapter: bare } : undefined;
    },
  };
}

const queueModuleEntries = import.meta.glob<{
  default: AnyDeviceQueueAdapter | readonly AnyDeviceQueueAdapter[];
}>('./*/queue.ts', { eager: true });

const queueAdapterRegistry = createQueueAdapterRegistry(
  Object.values(queueModuleEntries).flatMap((entry) =>
    Array.isArray(entry.default) ? [...entry.default] : [entry.default],
  ),
);

export function allQueueAdapters(): readonly AnyDeviceQueueAdapter[] {
  return queueAdapterRegistry.all();
}

export function resolveQueueAdapter(
  queueType: drivers.QueueDataType,
  queueId: string,
): QueueAdapterResolution {
  return queueAdapterRegistry.resolve(queueType, queueId);
}
