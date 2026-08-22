import { useRef } from 'react';

import type { FrameEntry } from '@/api/frame-parser';
import type { usbvideo } from '@/api/proto.js';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import {
  countActiveCameras,
  isCameraActive,
  updateCameraActivity,
  type CameraActivity,
} from './camera-activity';
import { formatCameraName } from './camera-source';

/** Camera labels survive pausing: envelopes stop arriving but the queues
 * remain, so remember the last label seen per queue. */
const rememberedLabels = new Map<string, string>();

function ptrKeyOf(ptr: Uint8Array): string {
  let key = '';
  for (const byte of ptr) {
    key += byte.toString(16).padStart(2, '0');
  }
  return key;
}

export interface CamerasSummaryCardProps {
  pointers: readonly { queueId: string; ptr: Uint8Array }[];
  videoSources: readonly FrameEntry<usbvideo.IRxEnvelope>[];
  paused: boolean;
}

function CamerasSummaryCard({ pointers, videoSources, paused }: CamerasSummaryCardProps) {
  for (const source of videoSources) {
    rememberedLabels.set(source.queueId, formatCameraName(source.data, source.queueId));
  }

  const activityRef = useRef(new Map<string, CameraActivity>());
  const nowMs = Date.now();
  activityRef.current = updateCameraActivity(
    activityRef.current,
    pointers.map(({ queueId, ptr }) => ({ queueId, ptrKey: ptrKeyOf(ptr) })),
    nowMs,
  );
  const activeCount = countActiveCameras(activityRef.current, nowMs);

  return (
    <DeviceWidgetShell
      title="Cameras"
      subtitle={paused ? 'video paused — frames not transferred' : 'USB video'}
    >
      <div className="flex items-end gap-2">
        <div className="font-mono text-lg font-semibold leading-none text-accent-success">
          {activeCount} active
        </div>
        <div className="text-xs text-text-muted">/ {pointers.length} known</div>
      </div>
      <div className="mt-2 flex min-w-0 flex-col gap-1">
        {pointers.map(({ queueId }, index) => {
          const active = isCameraActive(activityRef.current, queueId, nowMs);
          const label = rememberedLabels.get(queueId) ?? `Camera ${index + 1}`;
          return (
            <div key={queueId} className="flex min-w-0 items-center gap-2 text-xs">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-accent-success' : 'bg-border-subtle'}`}
                aria-label={active ? 'active' : 'inactive'}
              />
              <span className="truncate text-text-primary">{label}</span>
              <span className={`ml-auto shrink-0 uppercase ${active ? 'text-accent-success' : 'text-text-muted'}`}>
                {active ? 'recording' : 'stalled'}
              </span>
            </div>
          );
        })}
      </div>
    </DeviceWidgetShell>
  );
}

export default CamerasSummaryCard;
