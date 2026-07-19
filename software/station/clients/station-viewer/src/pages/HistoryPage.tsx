import { useEffect, useMemo, useRef } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import HistoryElement from '@/components/history/HistoryElement';
import type { HistoryElementData } from '@/components/history/HistoryElement';
import Timeline from '@/components/Timeline';
import TimelineControls from '@/components/TimelineControls';
import { historyOrderFor } from '@/devices/history-registry';
import {
  useFrameData,
  useInferenceTags,
  useKeyboardNavigation,
  useStartupMarkers,
  useTimelineState,
  type TimelineControlsRef,
} from '@/hooks';
import { formatPtrBytes } from '@/utils/format-bytes';

function formatTimestampNs(timestampNs: Long | number | null | undefined): string {
  if (!timestampNs) return 'N/A';
  return `${Long.fromValue(timestampNs).toString()}ns`;
}

function localDate(timestampNs: Long | number | null | undefined): Date | null {
  if (!timestampNs) return null;
  return new Date(Long.fromValue(timestampNs).div(1_000_000).toNumber());
}

export default function HistoryPage() {
  const { state: timelineState, actions: timelineActions } = useTimelineState();
  const startups = useStartupMarkers();
  const tags = useInferenceTags();
  const timelineControlsRef = useRef<TimelineControlsRef>(null);
  const { parsedFrame, isLoading: isReadingEntry, error: entryError } = useFrameData({
    frameNumber: timelineState.isLoading || timelineState.error ? null : timelineState.currentFrame,
    immediate: timelineState.isNavigationImmediate,
  });

  useKeyboardNavigation(timelineActions, timelineState, { gotoInputRef: timelineControlsRef });
  useEffect(() => webSocketManager.acquireHistoryMode(), []);

  const elements = useMemo<HistoryElementData[]>(() => {
    if (!parsedFrame) return [];
    const decoded = parsedFrame.devices.all().flatMap(({ codec, entries }) =>
      entries.map((entry) => ({ kind: 'decoded' as const, codec, entry })),
    ).sort((left, right) =>
      historyOrderFor(left.codec) - historyOrderFor(right.codec)
      || left.codec.key.localeCompare(right.codec.key)
      || left.entry.queueId.localeCompare(right.entry.queueId),
    );
    const raw = Object.entries(parsedFrame.otherEntries ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([queueId, entry]) => ({ kind: 'raw' as const, queueId, ...entry }));
    return [...decoded, ...raw];
  }, [parsedFrame]);

  const date = localDate(parsedFrame?.localStampNs);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 p-4">
        <h1 className="mb-2 text-xl font-bold text-text-primary">History Timeline</h1>
        {timelineState.isLoading ? (
          <div className="p-8 text-center text-text-label">Loading frame range from NormFS...</div>
        ) : timelineState.error ? (
          <div className="p-8 text-center text-accent-critical">{timelineState.error}</div>
        ) : (
          <>
            <p className="mb-2 text-text-label">Navigate through inference frames from NormFS.</p>
            <Timeline state={timelineState} actions={timelineActions} startups={startups} tags={tags} />
            <div className="mt-3">
              <TimelineControls ref={timelineControlsRef} state={timelineState} actions={timelineActions} />
            </div>
          </>
        )}
      </div>

      {!timelineState.isLoading && !timelineState.error && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="rounded-lg bg-surface-secondary p-3">
            <h2 className="mb-2 text-base font-semibold text-text-primary">Entry Data</h2>
            {isReadingEntry && <div className="text-accent-info">Reading entry {timelineState.currentFrame.toLocaleString()}...</div>}
            {entryError && <div className="text-accent-critical">Error: {entryError}</div>}

            {!isReadingEntry && !entryError && parsedFrame && (
              <div className="space-y-4">
                <div className="grid gap-2 rounded bg-surface-primary p-3 text-xs md:grid-cols-2">
                  <div className="font-mono text-accent-info">Local: {formatTimestampNs(parsedFrame.localStampNs)}</div>
                  <div className="font-mono text-accent-success">Monotonic: {formatTimestampNs(parsedFrame.monotonicStampNs)}</div>
                  <div className="font-mono text-accent-warning">App Start ID: {parsedFrame.appStartId?.toString() ?? 'N/A'}</div>
                  {date && <div className="font-mono text-accent-secondary">{date.toLocaleString()}</div>}
                </div>

                <div className="rounded bg-surface-primary p-3">
                  <div className="mb-2 text-sm text-text-label">Frame Queues:</div>
                  <div className="space-y-2 text-xs">
                    {elements.map((element) => {
                      const queueId = element.kind === 'decoded' ? element.entry.queueId : element.queueId;
                      const ptr = element.kind === 'decoded' ? element.entry.ptr : element.ptr;
                      const label = element.kind === 'decoded' ? element.codec.key : 'unknown';
                      return (
                        <div key={`${label}:${queueId}`} className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="truncate font-mono text-accent-warning">{queueId}</span>
                            <span className="rounded bg-accent-info/10 px-1 py-0.5 text-accent-info">{label}</span>
                          </div>
                          <span className="shrink-0 font-mono text-text-label">{formatPtrBytes(ptr)}</span>
                        </div>
                      );
                    })}
                    {elements.length === 0 && <div className="text-text-muted">No queue entries.</div>}
                  </div>
                </div>

                {parsedFrame.issues.length > 0 && (
                  <div className="rounded border border-accent-warning/50 bg-surface-primary p-3">
                    <div className="mb-2 text-sm text-accent-warning">Frame issues</div>
                    <ul className="space-y-1 text-xs text-text-secondary">
                      {parsedFrame.issues.map((issue) => (
                        <li key={`${issue.stage}:${issue.queueId}:${issue.message}`}>
                          [{issue.stage}] {issue.queueId || '(missing queue)'}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-sm text-text-label">Decoded entries ({elements.length})</h3>
                  {elements.map((element, index) => {
                    const queueId = element.kind === 'decoded' ? element.entry.queueId : element.queueId;
                    const key = element.kind === 'decoded' ? element.codec.key : 'raw';
                    return <HistoryElement key={`${key}:${queueId}`} element={element} index={index} />;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
