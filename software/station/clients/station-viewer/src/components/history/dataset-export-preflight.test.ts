import Long from 'long';
import { describe, expect, it } from 'vitest';
import type { NormFsClient } from '@/api/normfs';
import { inference, normvla } from '@/api/proto.js';
import { hasDatasetData } from './dataset-export-preflight';

function pointer(value: number): Uint8Array {
  return new Uint8Array(Long.fromNumber(value, true).toBytesLE());
}

function reader(...responses: Uint8Array[]): Pick<NormFsClient, 'readSingleEntry'> {
  let responseIndex = 0;
  return {
    async readSingleEntry() {
      return { id: new Uint8Array(), data: responses[responseIndex++]! };
    },
  };
}

function snapshot(queuePointer: number): Uint8Array {
  return inference.InferenceRx.encode({ entries: [{
    queue: '/station/abc/inference/normvla',
    ptr: pointer(queuePointer),
  }] }).finish();
}

function normvlaFrame(globalFrameId: number): Uint8Array {
  return normvla.Frame.encode({ globalFrameId: pointer(globalFrameId) }).finish();
}

describe('hasDatasetData', () => {
  it('confirms that the latest queue record belongs to the selected inference-state range', async () => {
    await expect(hasDatasetData(
      reader(snapshot(7), normvlaFrame(150)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(true);
  });

  it('reports no data when the queue did not publish a frame within the selected range', async () => {
    await expect(hasDatasetData(
      reader(snapshot(7), normvlaFrame(99)),
      'inference/normvla',
      100,
      200,
    )).resolves.toBe(false);
  });
});
