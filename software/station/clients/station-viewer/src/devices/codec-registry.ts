import type { drivers } from '@/api/proto.js';
import type { AnyDeviceCodec } from './codec';

export type CodecResolution =
  | { readonly codec: AnyDeviceCodec }
  | { readonly ambiguous: readonly AnyDeviceCodec[] }
  | undefined;

export interface CodecRegistry {
  all(): readonly AnyDeviceCodec[];
  resolve(queueType: drivers.QueueDataType, queueId: string): CodecResolution;
}

export function createCodecRegistry(codecs: readonly AnyDeviceCodec[]): CodecRegistry {
  const sorted = [...codecs].sort((left, right) => left.key.localeCompare(right.key));
  const keys = new Set<string>();
  const codecsByType = new Map<drivers.QueueDataType, AnyDeviceCodec[]>();

  for (const codec of sorted) {
    if (keys.has(codec.key)) {
      throw new Error(`Duplicate device codec key: ${codec.key}`);
    }
    keys.add(codec.key);

    const sameType = codecsByType.get(codec.queueType) ?? [];
    sameType.push(codec);
    codecsByType.set(codec.queueType, sameType);
  }

  for (const [queueType, sameType] of codecsByType) {
    const bare = sameType.filter((codec) => !codec.matchQueue);
    if (bare.length > 1) {
      throw new Error(`Multiple bare device codecs for queue type ${queueType}.`);
    }
  }

  return {
    all: () => sorted,
    resolve(queueType, queueId) {
      const sameType = codecsByType.get(queueType) ?? [];
      const specific = sameType.filter((codec) => codec.matchQueue?.(queueId) === true);

      if (specific.length > 1) {
        return { ambiguous: specific };
      }
      if (specific.length === 1) {
        return { codec: specific[0] };
      }

      const bare = sameType.find((codec) => !codec.matchQueue);
      return bare ? { codec: bare } : undefined;
    },
  };
}

const codecModuleEntries = import.meta.glob<{
  default: AnyDeviceCodec | readonly AnyDeviceCodec[];
}>('./*/codec.ts', { eager: true });

const codecRegistry = createCodecRegistry(
  Object.values(codecModuleEntries).flatMap((entry) =>
    Array.isArray(entry.default) ? [...entry.default] : [entry.default],
  ),
);

export function allCodecs(): readonly AnyDeviceCodec[] {
  return codecRegistry.all();
}

export function resolveCodec(
  queueType: drivers.QueueDataType,
  queueId: string,
): CodecResolution {
  return codecRegistry.resolve(queueType, queueId);
}
