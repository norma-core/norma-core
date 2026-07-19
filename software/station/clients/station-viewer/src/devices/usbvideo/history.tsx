import type { usbvideo } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { usbVideoQueue } from './queue';

function Summary({ entry }: { entry: FrameEntry<usbvideo.IRxEnvelope> }) {
  return <div className="text-xs text-accent-data">Frames: {entry.data.frames?.stamps?.length ?? 0}</div>;
}

function cropBytes(value: unknown, label: string): unknown {
  return typeof value === 'string' && value.length > 100
    ? `[${label}: ${value.length} chars] ${value.slice(0, 50)}...`
    : value;
}

export default defineHistory({
  queue: usbVideoQueue,
  order: 4,
  Summary,
  loadExpanded: () => import('./ui/UsbVideoHistoryView'),
  toJson: (data) => {
    const object = usbVideoQueue.message.toObject(data, { longs: String, enums: String, bytes: String, defaults: true });
    const frames = object.frames as Record<string, unknown> | undefined;
    if (frames && Array.isArray(frames.framesData)) {
      frames.framesData = frames.framesData.map((value, index) => cropBytes(value, `frame ${index + 1}`));
      frames.linearData = cropBytes(frames.linearData, 'linear frame');
    }
    return object;
  },
});
