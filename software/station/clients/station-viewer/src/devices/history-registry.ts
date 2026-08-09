import type { AnyDeviceQueueAdapter } from './queue-adapter';
import type { AnyHistoryAdapter, HistoryAdapterLookup } from './history';

export function createHistoryAdapterLookup(
  adapters: readonly AnyHistoryAdapter[],
): HistoryAdapterLookup {
  const byQueue = new Map<AnyDeviceQueueAdapter, AnyHistoryAdapter>();

  for (const adapter of adapters) {
    if (byQueue.has(adapter.queue)) {
      throw new Error(`Duplicate history adapter for queue ${adapter.queue.key}.`);
    }
    byQueue.set(adapter.queue, adapter);
  }

  return {
    forQueue: (queue) => byQueue.get(queue),
    orderFor: (queue) => byQueue.get(queue)?.order ?? Number.POSITIVE_INFINITY,
  };
}

const historyModuleEntries = import.meta.glob<{
  default: AnyHistoryAdapter | readonly AnyHistoryAdapter[];
}>('./*/history.tsx', { eager: true });

const historyAdapters = createHistoryAdapterLookup(
  Object.values(historyModuleEntries).flatMap((entry) =>
    Array.isArray(entry.default) ? [...entry.default] : [entry.default],
  ),
);

export function historyAdapterFor(queue: AnyDeviceQueueAdapter): AnyHistoryAdapter | undefined {
  return historyAdapters.forQueue(queue);
}

export function historyOrderFor(queue: AnyDeviceQueueAdapter): number {
  return historyAdapters.orderFor(queue);
}
