import { describe, expect, it } from 'vitest';
import type { NormFsClient } from '@/api/normfs';
import { inference } from '@/api/proto.js';
import { hasDatasetData } from './dataset-export-preflight';

const START_LABEL = Uint8Array.of(100);
const END_LABEL = Uint8Array.of(200);

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
      const data = responses.get(entryId[0]);
      if (!data) throw new Error(`Unexpected inference-states pointer: ${entryId[0]}`);
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
  it.each([
    ['different pointers', pointer(7n), pointer(12n), true],
    ['equal pointers', pointer(7n), pointer(7n), false],
    ['missing start pointer', null, pointer(12n), false],
    ['missing end pointer', pointer(7n), null, false],
  ])('handles %s', async (_case, start, end, expected) => {
    await expect(hasDatasetData(
      reader(start, end),
      'inference/normvla',
      START_LABEL,
      END_LABEL,
    )).resolves.toBe(expected);
  });

  it('compares 128-bit queue pointers without losing precision', async () => {
    const start = 1n << 64n;
    await expect(hasDatasetData(
      reader(pointer(start, 16), pointer(start + 1n, 16)),
      'inference/normvla',
      START_LABEL,
      END_LABEL,
    )).resolves.toBe(true);
  });
});
