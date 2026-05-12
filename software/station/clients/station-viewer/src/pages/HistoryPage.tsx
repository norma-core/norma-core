import { useEffect, useRef } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import { getQueueType } from '@/api/queue-utils';
import { formatPtrBytes } from '@/utils/format-bytes';
import HistoryElement from '@/components/history/HistoryElement';
import Timeline from '@/components/Timeline';
import TimelineControls from '@/components/TimelineControls';
import { useFrameData, useTimelineState, useKeyboardNavigation, useStartupMarkers, useInferenceTags, TimelineControlsRef } from '@/hooks';

export const MAX_INITIAL_ENTRIES = 500000;

function formatTimestampNs(timestampNs: Long | number | null | undefined): string {
  if (!timestampNs) return 'N/A';
  const timestampLong = typeof timestampNs === 'number' ? Long.fromNumber(timestampNs) : timestampNs;
  return `${timestampLong.toString()}ns`;
}

function formatLocalTimestamp(timestampNs: Long | number | null | undefined): { date: Date | null } {
  if (!timestampNs) return { date: null };
  const timestampLong = typeof timestampNs === 'number' ? Long.fromNumber(timestampNs) : timestampNs;
  const timestampMs = timestampLong.div(1000000).toNumber();
  return { date: new Date(timestampMs) };
}

function HistoryPage() {
  const { state: timelineState, actions: timelineActions } = useTimelineState();
  const startups = useStartupMarkers();
  const tags = useInferenceTags();
  const timelineControlsRef = useRef<TimelineControlsRef>(null);

  const {
    currentFrame,
    parsedFrame,
    isLoading: isReadingEntry,
    error: entryError,
    selectFrame: selectFrameData,
  } = useFrameData();

  useEffect(() => {
    if (timelineState.currentFrame !== currentFrame) {
      selectFrameData(timelineState.currentFrame, timelineState.isNavigationImmediate);
    }
  }, [timelineState.currentFrame, currentFrame, selectFrameData, timelineState.isNavigationImmediate]);

  useKeyboardNavigation(timelineActions, timelineState, { gotoInputRef: timelineControlsRef });

  useEffect(() => {
    webSocketManager.stopUpdating();
    return () => {
      webSocketManager.resumeUpdating();
    };
  }, []);

  const videoQueueCount = parsedFrame?.videoQueues?.length ?? 0;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-text-primary mb-2">History Timeline</h1>

        {timelineState.isLoading ? (
          <div className="text-center p-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-info mx-auto mb-4"></div>
            <p className="text-text-label">Loading frame range from NormFS...</p>
          </div>
        ) : timelineState.error ? (
          <div className="text-center p-8">
            <div className="text-accent-critical text-xl mb-4">!</div>
            <p className="text-accent-critical mb-4">{timelineState.error}</p>
          </div>
        ) : (
          <div className="mb-3">
            <p className="text-text-label mb-2">
              Navigate through inference frames from NormFS.
              Click to select frames, drag to zoom.
            </p>
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span>Range: <span className="font-mono">{timelineState.range.min.toLocaleString()} - {timelineState.range.max.toLocaleString()}</span></span>
              <span className="text-text-dim">|</span>
              <span>Keys: <kbd className="px-1 bg-surface-tertiary rounded">G</kbd> goto, <kbd className="px-1 bg-surface-tertiary rounded">←</kbd>/<kbd className="px-1 bg-surface-tertiary rounded">→</kbd> nav, <kbd className="px-1 bg-surface-tertiary rounded">Home</kbd>/<kbd className="px-1 bg-surface-tertiary rounded">End</kbd> jump, <kbd className="px-1 bg-surface-tertiary rounded">Esc</kbd> reset zoom</span>
            </div>
          </div>
        )}

        {!timelineState.isLoading && !timelineState.error && (
          <>
            <Timeline state={timelineState} actions={timelineActions} startups={startups} tags={tags} />
            <div className="mt-3">
              <TimelineControls ref={timelineControlsRef} state={timelineState} actions={timelineActions} />
            </div>
          </>
        )}

        {!timelineState.isLoading && !timelineState.error && (
          <div className="overflow-y-auto flex-1 min-h-0">
            <>
            <div className="mt-4 p-3 bg-surface-secondary rounded-lg">
              <h3 className="text-base font-semibold text-text-primary mb-2">Entry Data</h3>

              {isReadingEntry && (
                <div className="flex items-center gap-2 text-accent-info">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent-info"></div>
                  <span>Reading entry {currentFrame.toLocaleString()}...</span>
                </div>
              )}

              {entryError && (
                <div className="text-accent-critical">
                  <span className="font-semibold">Error:</span> {entryError}
                </div>
              )}

              {!isReadingEntry && !entryError && parsedFrame && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <span className="text-text-secondary">
                      Entry ID: <span className="text-accent-info font-mono">
                        {parsedFrame.stateId ? Long.fromBytesLE(Array.from(parsedFrame.stateId)).toString() : 'N/A'}
                        {parsedFrame.stateId && (
                          <span className="text-text-muted ml-2">
                            ({Array.from(parsedFrame.stateId).map(b => b.toString(16).padStart(2, '0')).join(' ')})
                          </span>
                        )}
                      </span>
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-surface-primary p-3 rounded">
                      <div className="text-sm text-text-label mb-2">Frame Timestamps:</div>
                      <div className="text-xs space-y-2">
                        <div className="grid grid-cols-1 gap-1">
                          <div className="text-accent-info font-mono">
                            <span className="text-text-label">Local:</span> {formatTimestampNs(parsedFrame.localStampNs)}
                          </div>
                          <div className="text-accent-success font-mono">
                            <span className="text-text-label">Monotonic:</span> {formatTimestampNs(parsedFrame.monotonicStampNs)}
                          </div>
                          <div className="text-accent-warning font-mono">
                            <span className="text-text-label">App Start ID:</span> {parsedFrame.appStartId ? parsedFrame.appStartId.toString() : 'N/A'}
                          </div>
                          {(() => {
                            const { date } = formatLocalTimestamp(parsedFrame.localStampNs);
                            return date ? (
                              <div className="text-accent-secondary font-mono space-y-1">
                                <div><span className="text-text-label">Local Date:</span> {date.toLocaleDateString()}</div>
                                <div><span className="text-text-label">Local Time:</span> {date.toLocaleTimeString()}</div>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    </div>

                    <div className="bg-surface-primary p-3 rounded">
                      <div className="text-sm text-text-label mb-2">Frame Queues:</div>
                      <div className="text-xs space-y-2">
                        {parsedFrame.st3215 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.st3215.queueId}</span>
                              <span className="text-accent-info text-xs px-1 py-0.5 bg-accent-info/10 rounded">ST3215</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.st3215.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.videoQueues?.map((video) => (
                          <div key={video.queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{video.queueId}</span>
                              <span className="text-accent-success text-xs px-1 py-0.5 bg-accent-success/10 rounded">VIDEO</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(video.ptr)}
                            </div>
                          </div>
                        ))}
                        {parsedFrame.mirroring && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.mirroring.queueId}</span>
                              <span className="text-accent-secondary text-xs px-1 py-0.5 bg-accent-secondary/10 rounded">MIRRORING</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.mirroring.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.normvla && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.normvla.queueId}</span>
                              <span className="text-accent-danger text-xs px-1 py-0.5 bg-accent-danger/10 rounded">INFERENCE</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.normvla.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.sysinfo && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.sysinfo.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">SYSINFO</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.sysinfo.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.yahboom_dogzilla_lite && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.yahboom_dogzilla_lite.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">YAHBOOM_DOGZILLA_LITE</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.yahboom_dogzilla_lite.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.otherEntries && Object.entries(parsedFrame.otherEntries).map(([queueId, entry]) => (
                          <div key={queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{queueId}</span>
                              <span className="text-text-label text-xs px-1 py-0.5 bg-surface-tertiary/30 rounded">OTHER</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(entry.ptr)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!isReadingEntry && !entryError && !parsedFrame && (
                <div className="text-text-label text-sm">
                  Click on a frame in the timeline to read its entry data
                </div>
              )}
            </div>

            {parsedFrame && (
              <div className="mt-4 p-3 bg-surface-secondary rounded-lg">
                <h3 className="text-base font-semibold text-text-primary mb-2">Queue Entries</h3>
                <div className="space-y-3">
                  {parsedFrame.st3215 && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.st3215.queueId,
                        entryId: parsedFrame.st3215.ptr,
                        data: parsedFrame.st3215.data,
                        rawData: parsedFrame.st3215.rawData ?? null,
                        type: getQueueType(parsedFrame.st3215.queueType),
                        queueType: parsedFrame.st3215.queueType,
                      }}
                      index={0}
                      dataQueueType="st3215"
                      dataQueueId={parsedFrame.st3215.queueId}
                    />
                  )}
                  {parsedFrame.videoQueues?.map((video, idx) => (
                    <HistoryElement
                      key={video.queueId}
                      element={{
                        queueId: video.queueId,
                        entryId: video.ptr,
                        data: video.data,
                        rawData: video.rawData ?? null,
                        type: getQueueType(video.queueType),
                        queueType: video.queueType,
                      }}
                      index={idx + 1}
                      dataQueueType="usbvideo"
                      dataQueueId={video.queueId}
                    />
                  ))}
                  {parsedFrame.mirroring && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.mirroring.queueId,
                        entryId: parsedFrame.mirroring.ptr,
                        data: parsedFrame.mirroring.data,
                        rawData: parsedFrame.mirroring.rawData ?? null,
                        type: getQueueType(parsedFrame.mirroring.queueType),
                        queueType: parsedFrame.mirroring.queueType,
                      }}
                      index={videoQueueCount + 1}
                      dataQueueType="mirroring"
                      dataQueueId={parsedFrame.mirroring.queueId}
                    />
                  )}
                  {parsedFrame.sysinfo && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.sysinfo.queueId,
                        entryId: parsedFrame.sysinfo.ptr,
                        data: parsedFrame.sysinfo.data,
                        rawData: parsedFrame.sysinfo.rawData ?? null,
                        type: getQueueType(parsedFrame.sysinfo.queueType),
                        queueType: parsedFrame.sysinfo.queueType,
                      }}
                      index={videoQueueCount + (parsedFrame.mirroring ? 2 : 1)}
                      dataQueueType="sysinfo"
                      dataQueueId={parsedFrame.sysinfo.queueId}
                    />
                  )}
                  {parsedFrame.yahboom_dogzilla_lite && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.yahboom_dogzilla_lite.queueId,
                        entryId: parsedFrame.yahboom_dogzilla_lite.ptr,
                        data: parsedFrame.yahboom_dogzilla_lite.data,
                        rawData: parsedFrame.yahboom_dogzilla_lite.rawData ?? null,
                        type: getQueueType(parsedFrame.yahboom_dogzilla_lite.queueType),
                        queueType: parsedFrame.yahboom_dogzilla_lite.queueType,
                      }}
                      index={videoQueueCount + (parsedFrame.mirroring ? 2 : 1) + (parsedFrame.sysinfo ? 1 : 0)}
                      dataQueueType="yahboom-dogzilla-lite"
                      dataQueueId={parsedFrame.yahboom_dogzilla_lite.queueId}
                    />
                  )}
                  {parsedFrame.normvla && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.normvla.queueId,
                        entryId: parsedFrame.normvla.ptr,
                        data: parsedFrame.normvla.data,
                        rawData: parsedFrame.normvla.rawData ?? null,
                        type: 'normvla',
                        queueType: parsedFrame.normvla.queueType,
                      }}
                      index={videoQueueCount + (parsedFrame.mirroring ? 2 : 1) + (parsedFrame.sysinfo ? 1 : 0) + (parsedFrame.yahboom_dogzilla_lite ? 1 : 0)}
                      dataQueueType="normvla"
                      dataQueueId={parsedFrame.normvla.queueId}
                    />
                  )}
                  {parsedFrame.st3215Tx && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.st3215Tx.queueId,
                        entryId: parsedFrame.st3215Tx.ptr,
                        data: parsedFrame.st3215Tx.data,
                        rawData: parsedFrame.st3215Tx.rawData ?? null,
                        type: 'st3215tx',
                        queueType: parsedFrame.st3215Tx.queueType,
                      }}
                      index={videoQueueCount + (parsedFrame.mirroring ? 2 : 1) + (parsedFrame.sysinfo ? 1 : 0) + (parsedFrame.yahboom_dogzilla_lite ? 1 : 0) + (parsedFrame.normvla ? 1 : 0)}
                      dataQueueType="st3215tx"
                      dataQueueId={parsedFrame.st3215Tx.queueId}
                    />
                  )}
                  {parsedFrame.otherEntries && Object.entries(parsedFrame.otherEntries).map(([queueId, entry], idx) => (
                    <HistoryElement
                      key={`other-${queueId}`}
                      element={{
                        queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.data,
                        type: undefined,
                      }}
                      index={videoQueueCount + (parsedFrame.mirroring ? 2 : 1) + (parsedFrame.sysinfo ? 1 : 0) + (parsedFrame.yahboom_dogzilla_lite ? 1 : 0) + (parsedFrame.normvla ? 1 : 0) + (parsedFrame.st3215Tx ? 1 : 0) + idx}
                      dataQueueType="other"
                      dataQueueId={queueId}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryPage;
