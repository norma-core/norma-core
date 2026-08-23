import Long from 'long';
import { describe, expect, it } from 'vitest';
import type { NormFsClient } from '@/api/normfs';
import { inference } from '@/api/proto.js';
import { hasDatasetData } from './dataset-export-preflight';

function pointer(value: bigint, byteLength = 8): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let remaining = value;
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function reader(
  startPointer: Uint8Array | null,
  endPointer: Uint8Array | null,
): Pick<NormFsClient, 'readSingleEntry'> {
  const responses = new Map([
    [100, snapshot(startPointer)],
    [200, snapshot(endPointer)],
  ]);
  return {
    async readSingleEntry(queue, entryId) {
      expect(queue).toBe('inference-states');
      const frame = Long.fromBytesLE(Array.from(entryId), true).toNumber();
      const data = responses.get(frame);
      if (!data) throw new Error(`Unexpected inference-states pointer: ${frame}`);
      return { id: entryId, data };
    },
  };
}

function snapshot(queuePointer: Uint8Array | null): Uint8Array {
  if (queuePointer === null) {
    return inference.InferenceRx.encode({ entries: [] }).finish();
  }

  return inference.InferenceRx.encode({ entries: [{
    queue: '/station/abc/inference/normvla',
    ptr: queuePointer,
  }] }).finish();
}

describe('hasDatasetData', () => {
  it('confirms data when the queue pointer advanced between the start and end labels', async () => {
    await expect(hasDatasetData(
      reader(pointer(7n), pointer(12n)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(true);
  });

  it('reports no data when the queue pointer did not move', async () => {
    await expect(hasDatasetData(
      reader(pointer(7n), pointer(7n)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(false);
  });

  it('reports no data when the queue is missing from either inference-states label', async () => {
    await expect(hasDatasetData(
      reader(null, pointer(12n)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(false);

    await expect(hasDatasetData(
      reader(pointer(7n), null),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(false);
  });

  it('compares 128-bit queue pointers without losing precision', async () => {
    const start = 1n << 64n;
    await expect(hasDatasetData(
      reader(pointer(start, 16), pointer(start + 1n, 16)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(true);
  });
});
