import { describe, expect, it } from 'vitest';
import { CAMERA_ACTIVE_WINDOW_MS, countActiveCameras, updateCameraActivity } from './camera-activity';

describe('camera activity tracking', () => {
  it('marks a camera active while its queue pointer advances', () => {
    let activity = updateCameraActivity(new Map(), [{ queueId: 'usbvideo/a', ptrKey: '01' }], 1000);
    activity = updateCameraActivity(activity, [{ queueId: 'usbvideo/a', ptrKey: '02' }], 2000);

    expect(countActiveCameras(activity, 2000)).toBe(1);
  });

  it('marks a camera inactive when its pointer freezes past the window', () => {
    let activity = updateCameraActivity(new Map(), [{ queueId: 'usbvideo/a', ptrKey: '01' }], 1000);
    // Pointer never advances again.
    const later = 1000 + CAMERA_ACTIVE_WINDOW_MS + 1;
    activity = updateCameraActivity(activity, [{ queueId: 'usbvideo/a', ptrKey: '01' }], later);

    expect(countActiveCameras(activity, later)).toBe(0);
  });

  it('tracks cameras independently', () => {
    let activity = updateCameraActivity(
      new Map(),
      [
        { queueId: 'usbvideo/a', ptrKey: '01' },
        { queueId: 'usbvideo/b', ptrKey: '01' },
      ],
      1000,
    );
    const later = 1000 + CAMERA_ACTIVE_WINDOW_MS + 1;
    // Only camera a advances.
    activity = updateCameraActivity(
      activity,
      [
        { queueId: 'usbvideo/a', ptrKey: '02' },
        { queueId: 'usbvideo/b', ptrKey: '01' },
      ],
      later,
    );

    expect(countActiveCameras(activity, later)).toBe(1);
    expect(activity.size).toBe(2);
  });

  it('drops cameras that disappear from the inference state', () => {
    let activity = updateCameraActivity(new Map(), [{ queueId: 'usbvideo/a', ptrKey: '01' }], 1000);
    activity = updateCameraActivity(activity, [], 2000);

    expect(activity.size).toBe(0);
  });

  it('treats a first sighting as active', () => {
    const activity = updateCameraActivity(new Map(), [{ queueId: 'usbvideo/a', ptrKey: '01' }], 1000);
    expect(countActiveCameras(activity, 1000)).toBe(1);
  });
});
