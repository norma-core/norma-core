import type { drivers } from '@/api/proto.js';

export type QueueAdapterCardinality = 'single' | 'multiple';

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

const QUEUE_ADAPTER_BRAND: unique symbol = Symbol('station-viewer.queue-adapter');

interface DeviceQueueAdapterBase<T> {
  readonly [QUEUE_ADAPTER_BRAND]: (value: T) => T;
  readonly key: string;
  readonly message: ProtoMessageType<T>;
  readonly queueType: drivers.QueueDataType;
  readonly matchQueue?: (queueId: string) => boolean;
  readonly decode: (bytes: Uint8Array) => T;
  readonly afterDecode?: (decoded: T, context: DecodeContext) => T;
  readonly reusable?: (previous: FrameEntry<T>, context: DecodeContext) => boolean;
}

export interface SingleDeviceQueueAdapter<T> extends DeviceQueueAdapterBase<T> {
  readonly cardinality: 'single';
}

export interface MultiDeviceQueueAdapter<T> extends DeviceQueueAdapterBase<T> {
  readonly cardinality: 'multiple';
}

export type DeviceQueueAdapter<T> = SingleDeviceQueueAdapter<T> | MultiDeviceQueueAdapter<T>;

// Heterogeneous catalogs erase T once. Callers recover it only through the
// same branded queue adapter object via DeviceEntryStore.
export type AnyDeviceQueueAdapter = DeviceQueueAdapter<any>;

type QueueAdapterDefinition<T, Cardinality extends QueueAdapterCardinality> = {
  key: string;
  message: ProtoMessageType<T>;
  queueType: drivers.QueueDataType;
  cardinality: Cardinality;
  matchQueue?: (queueId: string) => boolean;
  afterDecode?: (decoded: T, context: DecodeContext) => T;
  reusable?: (previous: FrameEntry<T>, context: DecodeContext) => boolean;
};

export function defineQueueAdapter<T>(
  definition: QueueAdapterDefinition<T, 'single'>,
): SingleDeviceQueueAdapter<T>;
export function defineQueueAdapter<T>(
  definition: QueueAdapterDefinition<T, 'multiple'>,
): MultiDeviceQueueAdapter<T>;
export function defineQueueAdapter<T>(
  definition: QueueAdapterDefinition<T, QueueAdapterCardinality>,
): DeviceQueueAdapter<T> {
  if (!definition.key) {
    throw new Error('Device queue adapter key must not be empty.');
  }

  return Object.freeze({
    ...definition,
    decode: (bytes: Uint8Array) => definition.message.decode(bytes),
    [QUEUE_ADAPTER_BRAND]: (value: T) => value,
  }) as DeviceQueueAdapter<T>;
}

export interface DeviceEntryGroup {
  readonly adapter: AnyDeviceQueueAdapter;
  readonly entries: readonly FrameEntry<unknown>[];
}

export interface DeviceEntryStore {
  entriesOf<T>(queue: DeviceQueueAdapter<T>): readonly FrameEntry<T>[];
  entryOf<T>(queue: SingleDeviceQueueAdapter<T>): FrameEntry<T> | undefined;
  all(): readonly DeviceEntryGroup[];
}

class ImmutableDeviceEntryStore implements DeviceEntryStore {
  private readonly groups: ReadonlyMap<AnyDeviceQueueAdapter, readonly FrameEntry<unknown>[]>;
  private readonly orderedGroups: readonly DeviceEntryGroup[];

  constructor(groups: ReadonlyMap<AnyDeviceQueueAdapter, readonly FrameEntry<unknown>[]>) {
    this.groups = groups;
    this.orderedGroups = Object.freeze(
      [...groups].map(([adapter, entries]) => Object.freeze({ adapter, entries })),
    );
  }

  entriesOf<T>(queue: DeviceQueueAdapter<T>): readonly FrameEntry<T>[] {
    // Sound because only the parser stores decoder results, keyed by the exact
    // branded queue adapter object that produced T.
    return (this.groups.get(queue) ?? []) as readonly FrameEntry<T>[];
  }

  entryOf<T>(queue: SingleDeviceQueueAdapter<T>): FrameEntry<T> | undefined {
    return this.entriesOf(queue)[0];
  }

  all(): readonly DeviceEntryGroup[] {
    return this.orderedGroups;
  }
}

export function createDeviceEntryStore(
  groups: ReadonlyMap<AnyDeviceQueueAdapter, readonly FrameEntry<unknown>[]>,
): DeviceEntryStore {
  return new ImmutableDeviceEntryStore(groups);
}
