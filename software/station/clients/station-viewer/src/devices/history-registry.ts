import type { AnyDeviceCodec } from './codec';
import type { AnyHistoryAdapter, HistoryAdapterLookup } from './history';

export function createHistoryAdapterLookup(
  adapters: readonly AnyHistoryAdapter[],
): HistoryAdapterLookup {
  const byCodec = new Map<AnyDeviceCodec, AnyHistoryAdapter>();

  for (const adapter of adapters) {
    if (byCodec.has(adapter.codec)) {
      throw new Error(`Duplicate history adapter for codec ${adapter.codec.key}.`);
    }
    byCodec.set(adapter.codec, adapter);
  }

  return {
    forCodec: (codec) => byCodec.get(codec),
    orderFor: (codec) => byCodec.get(codec)?.order ?? Number.POSITIVE_INFINITY,
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

export function historyAdapterFor(codec: AnyDeviceCodec): AnyHistoryAdapter | undefined {
  return historyAdapters.forCodec(codec);
}

export function historyOrderFor(codec: AnyDeviceCodec): number {
  return historyAdapters.orderFor(codec);
}
