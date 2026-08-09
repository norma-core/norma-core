import type { frame } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';

export function formatBytes(bytes: Uint8Array, maxBytes = 256): string {
  return Array.from(bytes.slice(0, maxBytes), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export function formatBytesAsText(bytes: Uint8Array, maxBytes = 64): string {
  return Array.from(
    bytes.slice(0, maxBytes),
    (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'),
  ).join('');
}

export function formatTimestamp(stamp: frame.IFrameStamp): string {
  try {
    if (stamp.localStampNs) {
      const localTime = serverToLocal(stamp.monotonicStampNs || 0);
      return new Date(Number(localTime) / 1_000_000).toISOString();
    }
    return 'No timestamp';
  } catch {
    return `${stamp.localStampNs?.toString() || 'unknown'}ns`;
  }
}

export function createJpegBlobUrl(frameData: Uint8Array): string | null {
  try {
    const blob = new Blob([new Uint8Array(frameData)], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch {
    console.error('Failed to create JPEG blob');
    return null;
  }
}
