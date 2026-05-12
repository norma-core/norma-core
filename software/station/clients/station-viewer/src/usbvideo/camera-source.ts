import { FrameEntry } from '../api/frame-parser';
import { usbvideo } from '../api/proto.js';
import { getLiveCameraSourceId } from './live-camera-store';

export function getVideoSourceId(entry: FrameEntry<usbvideo.IRxEnvelope>): string {
  return getLiveCameraSourceId(entry.queueId, entry.data);
}

export function formatCameraName(source?: usbvideo.IRxEnvelope, fallback = 'No camera'): string {
  if (!source?.camera) {
    return fallback;
  }

  const deviceNumber = source.camera.product || source.camera.deviceNumber || 'Camera';
  const uniqueId = source.camera.uniqueId ? ` (${source.camera.uniqueId})` : '';
  return `${deviceNumber}${uniqueId}`;
}

export function getVideoSourceLabel(entry: FrameEntry<usbvideo.IRxEnvelope>): string {
  const id = entry.data.camera?.uniqueId ?? entry.queueId;
  const name = entry.data.camera?.product
    || (entry.data.camera?.deviceNumber !== undefined ? String(entry.data.camera.deviceNumber) : 'Camera');
  return id ? `${name} (${id})` : name;
}
