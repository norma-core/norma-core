import type { drivers } from '@/api/proto.js';

export type CodecCardinality = 'single' | 'multiple';

export interface FrameEntry<T> {
  queueId: string;
  ptr: Uint8Array;
  data: T;
  rawData?: Uint8Array | null;
  queueType: drivers.QueueDataType;
}

export interface ProtoMessageType<T> {
  decode(bytes: Uint8Array): T;
  toObject(message: T, options?: object): Record<string, unknown>;
}

export interface DecodeContext {
  queueId: string;
  shouldPublishVideoFrames: () => boolean;
}

const CODEC_BRAND: unique symbol = Symbol('station-viewer.codec');

interface DeviceCodecBase<T> {
  readonly [CODEC_BRAND]: (value: T) => T;
  readonly key: string;
  readonly message: ProtoMessageType<T>;
  readonly queueType: drivers.QueueDataType;
  readonly matchQueue?: (queueId: string) => boolean;
  readonly decode: (bytes: Uint8Array) => T;
  readonly afterDecode?: (decoded: T, context: DecodeContext) => T;
  readonly reusable?: (previous: FrameEntry<T>, context: DecodeContext) => boolean;
}

export interface SingleDeviceCodec<T> extends DeviceCodecBase<T> {
  readonly cardinality: 'single';
}

export interface MultiDeviceCodec<T> extends DeviceCodecBase<T> {
  readonly cardinality: 'multiple';
}

export type DeviceCodec<T> = SingleDeviceCodec<T> | MultiDeviceCodec<T>;

// Heterogeneous catalogs erase T once. Callers recover it only through the
// same branded codec object via DeviceEntryStore.
export type AnyDeviceCodec = DeviceCodec<any>;

type CodecDefinition<T, Cardinality extends CodecCardinality> = {
  key: string;
  message: ProtoMessageType<T>;
  queueType: drivers.QueueDataType;
  cardinality: Cardinality;
  matchQueue?: (queueId: string) => boolean;
  afterDecode?: (decoded: T, context: DecodeContext) => T;
  reusable?: (previous: FrameEntry<T>, context: DecodeContext) => boolean;
};

export function defineCodec<T>(
  definition: CodecDefinition<T, 'single'>,
): SingleDeviceCodec<T>;
export function defineCodec<T>(
  definition: CodecDefinition<T, 'multiple'>,
): MultiDeviceCodec<T>;
export function defineCodec<T>(
  definition: CodecDefinition<T, CodecCardinality>,
): DeviceCodec<T> {
  if (!definition.key) {
    throw new Error('Device codec key must not be empty.');
  }

  return Object.freeze({
    ...definition,
    decode: (bytes: Uint8Array) => definition.message.decode(bytes),
    [CODEC_BRAND]: (value: T) => value,
  }) as DeviceCodec<T>;
}

export interface DeviceEntryGroup {
  readonly codec: AnyDeviceCodec;
  readonly entries: readonly FrameEntry<unknown>[];
}

export interface DeviceEntryStore {
  entriesOf<T>(codec: DeviceCodec<T>): readonly FrameEntry<T>[];
  entryOf<T>(codec: SingleDeviceCodec<T>): FrameEntry<T> | undefined;
  all(): readonly DeviceEntryGroup[];
}

class ImmutableDeviceEntryStore implements DeviceEntryStore {
  private readonly groups: ReadonlyMap<AnyDeviceCodec, readonly FrameEntry<unknown>[]>;
  private readonly orderedGroups: readonly DeviceEntryGroup[];

  constructor(groups: ReadonlyMap<AnyDeviceCodec, readonly FrameEntry<unknown>[]>) {
    this.groups = groups;
    this.orderedGroups = Object.freeze(
      [...groups].map(([codec, entries]) => Object.freeze({ codec, entries })),
    );
  }

  entriesOf<T>(codec: DeviceCodec<T>): readonly FrameEntry<T>[] {
    // Sound because only the parser stores decoder results, keyed by the exact
    // branded codec object that produced T.
    return (this.groups.get(codec) ?? []) as readonly FrameEntry<T>[];
  }

  entryOf<T>(codec: SingleDeviceCodec<T>): FrameEntry<T> | undefined {
    return this.entriesOf(codec)[0];
  }

  all(): readonly DeviceEntryGroup[] {
    return this.orderedGroups;
  }
}

export function createDeviceEntryStore(
  groups: ReadonlyMap<AnyDeviceCodec, readonly FrameEntry<unknown>[]>,
): DeviceEntryStore {
  return new ImmutableDeviceEntryStore(groups);
}
