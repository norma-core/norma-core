import type { NormFsClient } from '@/api/normfs';
import { inference } from '@/api/proto.js';

const INFERENCE_STATES_QUEUE = 'inference-states';

function findQueuePointer(data: Uint8Array, queue: string): Uint8Array | null {
  const snapshot = inference.InferenceRx.decode(data);
  const requested = queue.trim();
  const entry = snapshot.entries.find((item) => (
    item.queue === requested || item.queue?.endsWith(`/${requested}`)
  ));
  if (!entry?.ptr?.length) return null;
  return entry.ptr;
}

async function readQueuePointer(
  reader: Pick<NormFsClient, 'readSingleEntry'>,
  queue: string,
  inferencePtr: Uint8Array,
): Promise<Uint8Array | null> {
  const entry = await reader.readSingleEntry(INFERENCE_STATES_QUEUE, inferencePtr);
  return findQueuePointer(entry.data, queue);
}

function pointersDiffer(left: Uint8Array, right: Uint8Array): boolean {
  return left.length !== right.length || left.some((byte, index) => byte !== right[index]);
}

export async function hasDatasetData(
  reader: Pick<NormFsClient, 'readSingleEntry'>,
  queue: string,
  from: Uint8Array,
  to: Uint8Array,
): Promise<boolean> {
  const [start, end] = await Promise.all([
    readQueuePointer(reader, queue, from),
    readQueuePointer(reader, queue, to),
  ]);
  return start !== null && end !== null && pointersDiffer(start, end);
}
