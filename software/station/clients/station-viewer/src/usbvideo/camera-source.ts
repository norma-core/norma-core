import Long from 'long';
import { FrameEntry } from '../api/frame-parser';
import { usbvideo } from '../api/proto.js';
import { serverToLocal } from '../api/timestamp-utils';
import { getLiveCameraSourceId } from './live-camera-store';

export function getVideoSourceId(entry: FrameEntry<usbvideo.IRxEnvelope>): string {
  return getLiveCameraSourceId(entry.queueId, entry.data);
}

const STALE_CAMERA_MAX_AGE_MS = 60_000;

export function isVideoSourceFresh(entry: FrameEntry<usbvideo.IRxEnvelope>, nowMs: number): boolean {
  const stampNs = entry.advancedStampNs ?? entry.data.stamp?.monotonicStampNs;
  if (!stampNs) {
    return true;
  }

  const ageMs = nowMs - serverToLocal(Long.fromValue(stampNs)).toNumber() / 1e6;
  return ageMs <= STALE_CAMERA_MAX_AGE_MS;
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
