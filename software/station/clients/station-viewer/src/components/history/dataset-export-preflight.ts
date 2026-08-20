import Long from 'long';
import type { NormFsClient } from '@/api/normfs';
import { inference, normvla } from '@/api/proto.js';

const INFERENCE_STATES_QUEUE = 'inference-states';

export async function hasDatasetData(
  reader: Pick<NormFsClient, 'readSingleEntry'>,
  queue: string,
  from: number,
  to: number,
): Promise<boolean> {
  const requestedQueue = queue.trim();
  const endSnapshotEntry = await reader.readSingleEntry(
    INFERENCE_STATES_QUEUE,
    new Uint8Array(Long.fromNumber(to, true).toBytesLE()),
  );
  const endSnapshot = inference.InferenceRx.decode(endSnapshotEntry.data);
  const queueEntry = endSnapshot.entries.find((entry) => (
    entry.queue === requestedQueue || entry.queue?.endsWith(`/${requestedQueue}`)
  ));

  if (!queueEntry?.queue || !queueEntry.ptr?.length) return false;

  const latestQueueEntry = await reader.readSingleEntry(queueEntry.queue, queueEntry.ptr);
  const latestFrame = normvla.Frame.decode(latestQueueEntry.data);
  if (!latestFrame.globalFrameId?.length) throw new Error('Frame global ID is empty');

  const latestFrameId = Long.fromBytesLE(Array.from(latestFrame.globalFrameId), true).toNumber();
  return latestFrameId >= from && latestFrameId <= to;
}
