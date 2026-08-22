/** Pointer-based camera liveness: a camera that captures keeps writing to
 * its queue, so its inference-state pointer advances between any two
 * frames; a dead or unplugged camera's pointer freezes. This works even
 * when frame payloads are not being fetched (video paused). */

/** With all cameras streaming, UI frame cycles can take seconds; the
 * window must comfortably exceed one cycle so a live camera is never
 * flagged inactive between two slow frames. */
export const CAMERA_ACTIVE_WINDOW_MS = 10_000;

export interface CameraPointer {
  queueId: string;
  /** Opaque, comparable rendering of the queue's latest entry pointer. */
  ptrKey: string;
}

export interface CameraActivity {
  lastPtrKey: string;
  lastAdvanceMs: number;
}

/** Returns a new activity map for the cameras currently listed in the
 * inference state; `lastAdvanceMs` refreshes whenever a pointer moved. */
export function updateCameraActivity(
  previous: Map<string, CameraActivity>,
  pointers: readonly CameraPointer[],
  nowMs: number,
): Map<string, CameraActivity> {
  const next = new Map<string, CameraActivity>();
  for (const { queueId, ptrKey } of pointers) {
    const before = previous.get(queueId);
    if (!before || before.lastPtrKey !== ptrKey) {
      next.set(queueId, { lastPtrKey: ptrKey, lastAdvanceMs: nowMs });
    } else {
      next.set(queueId, before);
    }
  }
  return next;
}

export function countActiveCameras(
  activity: Map<string, CameraActivity>,
  nowMs: number,
): number {
  let active = 0;
  for (const entry of activity.values()) {
    if (nowMs - entry.lastAdvanceMs <= CAMERA_ACTIVE_WINDOW_MS) {
      active += 1;
    }
  }
  return active;
}

export function isCameraActive(
  activity: Map<string, CameraActivity>,
  queueId: string,
  nowMs: number,
): boolean {
  const entry = activity.get(queueId);
  return entry !== undefined && nowMs - entry.lastAdvanceMs <= CAMERA_ACTIVE_WINDOW_MS;
}
