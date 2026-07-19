import Long from 'long';
import { drivers } from '@/api/proto.js';
import type { inference } from '@/api/proto.js';
import { getGlobalTimeAdjustmentNs, isTimeSyncActive } from '@/api/time-sync.js';
import {
  createDeviceEntryStore,
  type AnyDeviceCodec,
  type DecodeContext,
  type DeviceEntryStore,
  type FrameEntry,
} from '@/devices/codec';
import { resolveCodec } from '@/devices/codec-registry';

export type { FrameEntry } from '@/devices/codec';

export interface FrameEntryReader {
  readSingleEntry(
    queue: string,
    ptr: Uint8Array,
  ): Promise<{ data: Uint8Array; id: Uint8Array | null }>;
}

export interface FrameIssue {
  queueId: string;
  queueType?: drivers.QueueDataType;
  stage: 'read' | 'match' | 'decode' | 'cardinality';
  message: string;
}

export interface Frame {
  stateId?: Uint8Array;
  devices: DeviceEntryStore;
  issues: readonly FrameIssue[];
  otherEntries?: { [queueId: string]: { ptr: Uint8Array; data: Uint8Array } };
  localStampNs?: Long;
  monotonicStampNs?: Long;
  appStartId?: Long;
  timeAdjustment?: {
    isActive: boolean;
    adjustmentNs: Long;
    adjustmentNsNumber: number;
  };
}

export interface ParseFrameOptions {
  retainRawData?: boolean;
  shouldPublishVideoFrames?: () => boolean;
}

interface PreviousDecodedEntry {
  codec: AnyDeviceCodec;
  entry: FrameEntry<unknown>;
}

interface DecodedResult {
  kind: 'decoded';
  codec: AnyDeviceCodec;
  entry: FrameEntry<unknown>;
  issues: readonly FrameIssue[];
}

interface RawResult {
  kind: 'raw';
  queueId: string;
  ptr: Uint8Array;
  data: Uint8Array | null;
  issues: readonly FrameIssue[];
}

type ParsedResult = DecodedResult | RawResult;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function indexPreviousFrame(previousFrame?: Frame): {
  decoded: ReadonlyMap<string, PreviousDecodedEntry>;
  raw: ReadonlyMap<string, { ptr: Uint8Array; data: Uint8Array }>;
} {
  const decoded = new Map<string, PreviousDecodedEntry>();
  const raw = new Map<string, { ptr: Uint8Array; data: Uint8Array }>();

  if (!previousFrame) {
    return { decoded, raw };
  }

  for (const group of previousFrame.devices.all()) {
    for (const entry of group.entries) {
      decoded.set(entry.queueId, { codec: group.codec, entry });
    }
  }
  for (const [queueId, entry] of Object.entries(previousFrame.otherEntries ?? {})) {
    raw.set(queueId, entry);
  }

  return { decoded, raw };
}

export async function parseFrame(
  inferenceRx: inference.IInferenceRx,
  entryIdBytes: Uint8Array,
  reader: FrameEntryReader,
  previousFrame?: Frame,
  options: ParseFrameOptions = {},
): Promise<Frame> {
  const retainRawData = options.retainRawData ?? true;
  const shouldPublishVideoFrames = options.shouldPublishVideoFrames ?? (() => false);
  const previous = indexPreviousFrame(previousFrame);

  const results = await Promise.all((inferenceRx.entries ?? []).map(async (reference): Promise<ParsedResult> => {
    const queueId = reference.queue ?? '';
    const ptr = reference.ptr;
    const queueType = reference.type ?? undefined;

    if (!queueId || !ptr) {
      return {
        kind: 'raw',
        queueId,
        ptr: ptr ?? new Uint8Array(),
        data: null,
        issues: [{
          queueId,
          queueType,
          stage: 'read',
          message: 'Entry is missing a queue id or pointer.',
        }],
      };
    }

    const resolution = queueType === undefined
      ? undefined
      : resolveCodec(queueType, queueId);
    const codec = resolution && 'codec' in resolution ? resolution.codec : undefined;
    const matchIssues: FrameIssue[] = resolution && 'ambiguous' in resolution
      ? [{
          queueId,
          queueType,
          stage: 'match',
          message: `Ambiguous device codecs: ${resolution.ambiguous.map((candidate) => candidate.key).join(', ')}`,
        }]
      : [];
    const context: DecodeContext = { queueId, shouldPublishVideoFrames };

    const previousDecoded = previous.decoded.get(queueId);
    if (
      codec
      && previousDecoded?.codec === codec
      && bytesEqual(previousDecoded.entry.ptr, ptr)
      && (!retainRawData || previousDecoded.entry.rawData != null)
      && (codec.reusable?.(previousDecoded.entry, context) ?? true)
    ) {
      return {
        kind: 'decoded',
        codec,
        entry: Object.freeze({
          ...previousDecoded.entry,
          ptr,
          rawData: retainRawData ? previousDecoded.entry.rawData ?? null : null,
          queueType: codec.queueType,
        }),
        issues: matchIssues,
      };
    }

    const previousRaw = previous.raw.get(queueId);
    if (!codec && previousRaw && bytesEqual(previousRaw.ptr, ptr)) {
      return {
        kind: 'raw',
        queueId,
        ptr,
        data: retainRawData ? previousRaw.data : null,
        issues: matchIssues,
      };
    }

    let rawData: Uint8Array;
    try {
      rawData = (await reader.readSingleEntry(queueId, ptr)).data;
    } catch (error) {
      return {
        kind: 'raw',
        queueId,
        ptr,
        data: null,
        issues: [...matchIssues, {
          queueId,
          queueType,
          stage: 'read',
          message: error instanceof Error ? error.message : 'Failed to read queue entry.',
        }],
      };
    }

    if (!codec) {
      return {
        kind: 'raw',
        queueId,
        ptr,
        data: retainRawData ? rawData : null,
        issues: matchIssues,
      };
    }

    try {
      const decoded = codec.decode(rawData);
      const projected = codec.afterDecode?.(decoded, context) ?? decoded;
      return {
        kind: 'decoded',
        codec,
        entry: Object.freeze({
          queueId,
          ptr,
          data: projected,
          rawData: retainRawData ? rawData : null,
          queueType: codec.queueType,
        }),
        issues: matchIssues,
      };
    } catch (error) {
      return {
        kind: 'raw',
        queueId,
        ptr,
        data: retainRawData ? rawData : null,
        issues: [...matchIssues, {
          queueId,
          queueType,
          stage: 'decode',
          message: error instanceof Error ? error.message : `Failed to decode ${codec.key}.`,
        }],
      };
    }
  }));

  const mutableGroups = new Map<AnyDeviceCodec, FrameEntry<unknown>[]>();
  const otherEntries: { [queueId: string]: { ptr: Uint8Array; data: Uint8Array } } = {};
  const issues = results.flatMap((result) => result.issues);

  for (const result of results) {
    if (result.kind === 'decoded') {
      const entries = mutableGroups.get(result.codec) ?? [];
      entries.push(result.entry);
      mutableGroups.set(result.codec, entries);
    } else if (retainRawData && result.data) {
      otherEntries[result.queueId] = { ptr: result.ptr, data: result.data };
    }
  }

  for (const [codec, entries] of mutableGroups) {
    if (codec.cardinality === 'single' && entries.length > 1) {
      issues.push({
        queueId: entries.map((entry) => entry.queueId).join(', '),
        queueType: codec.queueType,
        stage: 'cardinality',
        message: `Device codec ${codec.key} expected one entry, received ${entries.length}.`,
      });
    }
  }

  const groups = new Map<AnyDeviceCodec, readonly FrameEntry<unknown>[]>(
    [...mutableGroups].map(([codec, entries]) => [codec, Object.freeze(entries)]),
  );
  const adjustmentNsNumber = getGlobalTimeAdjustmentNs();

  return {
    stateId: new Uint8Array(entryIdBytes),
    devices: createDeviceEntryStore(groups),
    issues: Object.freeze(issues),
    otherEntries: retainRawData ? otherEntries : undefined,
    localStampNs: inferenceRx.localStampNs ? Long.fromValue(inferenceRx.localStampNs) : undefined,
    monotonicStampNs: inferenceRx.monotonicStampNs
      ? Long.fromValue(inferenceRx.monotonicStampNs)
      : undefined,
    appStartId: inferenceRx.appStartId ? Long.fromValue(inferenceRx.appStartId) : undefined,
    timeAdjustment: {
      isActive: isTimeSyncActive(),
      adjustmentNs: Long.fromNumber(adjustmentNsNumber),
      adjustmentNsNumber,
    },
  };
}
