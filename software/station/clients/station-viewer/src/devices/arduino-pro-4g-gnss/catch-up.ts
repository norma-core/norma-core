/** Entries per catch-up upper bound: the 10 Hz stream produces 10 entries
 * a second, so 64 rides out multi-second UI stalls; larger gaps skip
 * forward (older entries may be evicted under the memory budget anyway). */
export const MAX_CATCH_UP_ENTRIES = 64;

export interface CatchUpRange {
  startId: number;
  count: number;
}

/** The window of queue entries to read so every epoch between the last
 * processed entry and the queue tail gets merged exactly once. */
export function planCatchUp(
  lastProcessedId: number | null,
  lastId: number,
  max: number = MAX_CATCH_UP_ENTRIES,
): CatchUpRange | null {
  if (lastProcessedId !== null && lastId <= lastProcessedId) {
    return null;
  }
  let startId = lastProcessedId === null ? lastId - max + 1 : lastProcessedId + 1;
  if (lastId - startId + 1 > max) {
    startId = lastId - max + 1;
  }
  if (startId < 0) {
    startId = 0;
  }
  return { startId, count: lastId - startId + 1 };
}
