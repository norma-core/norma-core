import { useEffect, useRef } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import { getQueueType } from '@/api/queue-utils';
import DatasetExportHelper from '@/components/history/DatasetExportHelper';
import HistoryElement from '@/components/history/HistoryElement';
import Timeline from '@/components/Timeline';
import TimelineControls from '@/components/TimelineControls';
import {
  useFrameData,
  useInferenceTags,
  useKeyboardNavigation,
  useStartupMarkers,
  useTimelineState,
  type TimelineControlsRef,
} from '@/hooks';
import { formatPtrBytes } from '@/utils/format-bytes';

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
    parsedFrame,
    isLoading: isReadingEntry,
    error: entryError,
  } = useFrameData({
    frameNumber: timelineState.isLoading || timelineState.error
      ? null
      : timelineState.currentFrame,
    immediate: timelineState.isNavigationImmediate,
  });

  useKeyboardNavigation(timelineActions, timelineState, { gotoInputRef: timelineControlsRef });

  useEffect(() => webSocketManager.acquireHistoryMode(), []);

  const videoQueueCount = parsedFrame?.videoQueues?.length ?? 0;
  const hikmicroThermalCount = parsedFrame?.hikmicroThermal?.length ?? 0;
  const st3215Count = parsedFrame?.st3215 ? 1 : 0;
  const vescTrampaCount = parsedFrame?.vescTrampa ? 1 : 0;
  const vescTrampaRxCount = parsedFrame?.vescTrampaRx ? 1 : 0;
  const vescTrampaTxCount = parsedFrame?.vescTrampaTx ? 1 : 0;
  const usbVideoTxCount = parsedFrame?.usbVideoTx ? 1 : 0;
  const mirroringCount = parsedFrame?.mirroring ? 1 : 0;
  const sysinfoCount = parsedFrame?.sysinfo ? 1 : 0;
  const arduinoNiclaSenseEnvCount = parsedFrame?.arduinoNiclaSenseEnv ? 1 : 0;
  const arduinoNiclaSenseMeCount = parsedFrame?.arduinoNiclaSenseMe ? 1 : 0;
  const arduinoPro4gGnssCount = parsedFrame?.arduinoPro4gGnss ? 1 : 0;
  const ina226Count = parsedFrame?.ina226?.length ?? 0;
  const dfrobotRs485Count = parsedFrame?.dfrobotRs485?.length ?? 0;
  const airgradientOpenAirCount = parsedFrame?.airgradientOpenAir?.length ?? 0;
  const victronSmartSolarCount = parsedFrame?.victronSmartSolar?.length ?? 0;
  const dmesgCount = parsedFrame?.dmesg ? 1 : 0;
  const yahboomDogzillaLiteCount = parsedFrame?.yahboom_dogzilla_lite ? 1 : 0;
  const normvlaCount = parsedFrame?.normvla ? 1 : 0;
  const st3215TxCount = parsedFrame?.st3215Tx ? 1 : 0;
  const vescTrampaIndex = st3215Count;
  const vescTrampaRxIndex = vescTrampaIndex + vescTrampaCount;
  const vescTrampaTxIndex = vescTrampaRxIndex + vescTrampaRxCount;
  const usbVideoTxIndex = vescTrampaTxIndex + vescTrampaTxCount;
  const videoQueuesIndex = usbVideoTxIndex + usbVideoTxCount;
  const hikmicroThermalIndex = videoQueuesIndex + videoQueueCount;
  const mirroringIndex = hikmicroThermalIndex + hikmicroThermalCount;
  const sysinfoIndex = mirroringIndex + mirroringCount;
  const arduinoNiclaSenseEnvIndex = sysinfoIndex + sysinfoCount;
  const arduinoNiclaSenseMeIndex = arduinoNiclaSenseEnvIndex + arduinoNiclaSenseEnvCount;
  const arduinoPro4gGnssIndex = arduinoNiclaSenseMeIndex + arduinoNiclaSenseMeCount;
  const ina226Index = arduinoPro4gGnssIndex + arduinoPro4gGnssCount;
  const dfrobotRs485Index = ina226Index + ina226Count;
  const airgradientOpenAirIndex = dfrobotRs485Index + dfrobotRs485Count;
  const victronSmartSolarIndex = airgradientOpenAirIndex + airgradientOpenAirCount;
  const dmesgIndex = victronSmartSolarIndex + victronSmartSolarCount;
  const yahboomDogzillaLiteIndex = dmesgIndex + dmesgCount;
  const normvlaIndex = yahboomDogzillaLiteIndex + yahboomDogzillaLiteCount;
  const st3215TxIndex = normvlaIndex + normvlaCount;
  const otherEntriesIndex = st3215TxIndex + st3215TxCount;

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
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-full overflow-x-auto pb-1">
                <TimelineControls ref={timelineControlsRef} state={timelineState} actions={timelineActions} />
              </div>
              <DatasetExportHelper tags={tags} />
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
                  <span>Reading entry {timelineState.currentFrame.toLocaleString()}...</span>
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
                        {parsedFrame.vescTrampaRx && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.vescTrampaRx.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">VESC</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.vescTrampaRx.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.vescTrampa && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.vescTrampa.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">VESC STATE</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.vescTrampa.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.vescTrampaTx && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.vescTrampaTx.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">VESC TX</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.vescTrampaTx.ptr)}
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
                        {parsedFrame.hikmicroThermal?.map((entry) => (
                          <div key={entry.queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{entry.queueId}</span>
                              <span className="text-accent-warning text-xs px-1 py-0.5 bg-accent-warning/10 rounded">HIKMICRO</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(entry.ptr)}
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
                        {parsedFrame.arduinoNiclaSenseEnv && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.arduinoNiclaSenseEnv.queueId}</span>
                              <span className="text-accent-success text-xs px-1 py-0.5 bg-accent-success/10 rounded">NICLA ENV</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.arduinoNiclaSenseEnv.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.arduinoNiclaSenseMe && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.arduinoNiclaSenseMe.queueId}</span>
                              <span className="text-accent-info text-xs px-1 py-0.5 bg-accent-info/10 rounded">NICLA ME</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.arduinoNiclaSenseMe.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.arduinoPro4gGnss && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{parsedFrame.arduinoPro4gGnss.queueId}</span>
                              <span className="text-accent-info text-xs px-1 py-0.5 bg-accent-info/10 rounded">GNSS</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(parsedFrame.arduinoPro4gGnss.ptr)}
                            </div>
                          </div>
                        )}
                        {parsedFrame.ina226?.map((entry) => (
                          <div key={entry.queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{entry.queueId}</span>
                              <span className="text-accent-warning text-xs px-1 py-0.5 bg-accent-warning/10 rounded">INA226</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(entry.ptr)}
                            </div>
                          </div>
                        ))}
                        {parsedFrame.dfrobotRs485?.map((entry) => (
                          <div key={entry.queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{entry.queueId}</span>
                              <span className="text-accent-data text-xs px-1 py-0.5 bg-accent-data/10 rounded">DFROBOT RS485</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(entry.ptr)}
                            </div>
                          </div>
                        ))}
                        {parsedFrame.victronSmartSolar?.map((entry) => (
                          <div key={entry.queueId} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-accent-warning font-mono">{entry.queueId}</span>
                              <span className="text-accent-success text-xs px-1 py-0.5 bg-accent-success/10 rounded">VICTRON MPPT</span>
                            </div>
                            <div className="text-text-label font-mono">
                              {formatPtrBytes(entry.ptr)}
                            </div>
                          </div>
                        ))}
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
                  {parsedFrame.vescTrampa && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.vescTrampa.queueId,
                        entryId: parsedFrame.vescTrampa.ptr,
                        data: parsedFrame.vescTrampa.data,
                        rawData: parsedFrame.vescTrampa.rawData ?? null,
                        type: getQueueType(parsedFrame.vescTrampa.queueType),
                        queueType: parsedFrame.vescTrampa.queueType,
                      }}
                      index={vescTrampaIndex}
                      dataQueueType="vesc-trampa"
                      dataQueueId={parsedFrame.vescTrampa.queueId}
                    />
                  )}
                  {parsedFrame.vescTrampaRx && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.vescTrampaRx.queueId,
                        entryId: parsedFrame.vescTrampaRx.ptr,
                        data: parsedFrame.vescTrampaRx.data,
                        rawData: parsedFrame.vescTrampaRx.rawData ?? null,
                        type: getQueueType(parsedFrame.vescTrampaRx.queueType),
                        queueType: parsedFrame.vescTrampaRx.queueType,
                      }}
                      index={vescTrampaRxIndex}
                      dataQueueType="vesc-trampa-rx"
                      dataQueueId={parsedFrame.vescTrampaRx.queueId}
                    />
                  )}
                  {parsedFrame.vescTrampaTx && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.vescTrampaTx.queueId,
                        entryId: parsedFrame.vescTrampaTx.ptr,
                        data: parsedFrame.vescTrampaTx.data,
                        rawData: parsedFrame.vescTrampaTx.rawData ?? null,
                        type: getQueueType(parsedFrame.vescTrampaTx.queueType),
                        queueType: parsedFrame.vescTrampaTx.queueType,
                      }}
                      index={vescTrampaTxIndex}
                      dataQueueType="vesc-trampa-tx"
                      dataQueueId={parsedFrame.vescTrampaTx.queueId}
                    />
                  )}
                  {parsedFrame.usbVideoTx && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.usbVideoTx.queueId,
                        entryId: parsedFrame.usbVideoTx.ptr,
                        data: parsedFrame.usbVideoTx.data,
                        rawData: parsedFrame.usbVideoTx.rawData ?? null,
                        type: getQueueType(parsedFrame.usbVideoTx.queueType),
                        queueType: parsedFrame.usbVideoTx.queueType,
                      }}
                      index={usbVideoTxIndex}
                      dataQueueType="usbvideo-tx"
                      dataQueueId={parsedFrame.usbVideoTx.queueId}
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
                      index={videoQueuesIndex + idx}
                      dataQueueType="usbvideo"
                      dataQueueId={video.queueId}
                    />
                  ))}
                  {parsedFrame.hikmicroThermal?.map((entry, idx) => (
                    <HistoryElement
                      key={entry.queueId}
                      element={{
                        queueId: entry.queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.rawData ?? null,
                        type: getQueueType(entry.queueType),
                        queueType: entry.queueType,
                      }}
                      index={hikmicroThermalIndex + idx}
                      dataQueueType="hikmicro-thermal"
                      dataQueueId={entry.queueId}
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
                      index={mirroringIndex}
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
                      index={sysinfoIndex}
                      dataQueueType="sysinfo"
                      dataQueueId={parsedFrame.sysinfo.queueId}
                    />
                  )}
                  {parsedFrame.arduinoNiclaSenseEnv && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.arduinoNiclaSenseEnv.queueId,
                        entryId: parsedFrame.arduinoNiclaSenseEnv.ptr,
                        data: parsedFrame.arduinoNiclaSenseEnv.data,
                        rawData: parsedFrame.arduinoNiclaSenseEnv.rawData ?? null,
                        type: getQueueType(parsedFrame.arduinoNiclaSenseEnv.queueType),
                        queueType: parsedFrame.arduinoNiclaSenseEnv.queueType,
                      }}
                      index={arduinoNiclaSenseEnvIndex}
                      dataQueueType="arduino-nicla-sense-env"
                      dataQueueId={parsedFrame.arduinoNiclaSenseEnv.queueId}
                    />
                  )}
                  {parsedFrame.arduinoNiclaSenseMe && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.arduinoNiclaSenseMe.queueId,
                        entryId: parsedFrame.arduinoNiclaSenseMe.ptr,
                        data: parsedFrame.arduinoNiclaSenseMe.data,
                        rawData: parsedFrame.arduinoNiclaSenseMe.rawData ?? null,
                        type: getQueueType(parsedFrame.arduinoNiclaSenseMe.queueType),
                        queueType: parsedFrame.arduinoNiclaSenseMe.queueType,
                      }}
                      index={arduinoNiclaSenseMeIndex}
                      dataQueueType="arduino-nicla-sense-me"
                      dataQueueId={parsedFrame.arduinoNiclaSenseMe.queueId}
                    />
                  )}
                  {parsedFrame.arduinoPro4gGnss && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.arduinoPro4gGnss.queueId,
                        entryId: parsedFrame.arduinoPro4gGnss.ptr,
                        data: parsedFrame.arduinoPro4gGnss.data,
                        rawData: parsedFrame.arduinoPro4gGnss.rawData ?? null,
                        type: getQueueType(parsedFrame.arduinoPro4gGnss.queueType),
                        queueType: parsedFrame.arduinoPro4gGnss.queueType,
                      }}
                      index={arduinoPro4gGnssIndex}
                      dataQueueType="arduino-pro-4g-gnss"
                      dataQueueId={parsedFrame.arduinoPro4gGnss.queueId}
                    />
                  )}
                  {parsedFrame.ina226?.map((entry, idx) => (
                    <HistoryElement
                      key={entry.queueId}
                      element={{
                        queueId: entry.queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.rawData ?? null,
                        type: getQueueType(entry.queueType),
                        queueType: entry.queueType,
                      }}
                      index={ina226Index + idx}
                      dataQueueType="ina226"
                      dataQueueId={entry.queueId}
                    />
                  ))}
                  {parsedFrame.dfrobotRs485?.map((entry, idx) => (
                    <HistoryElement
                      key={entry.queueId}
                      element={{
                        queueId: entry.queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.rawData ?? null,
                        type: getQueueType(entry.queueType),
                        queueType: entry.queueType,
                      }}
                      index={dfrobotRs485Index + idx}
                      dataQueueType="dfrobot-rs485"
                      dataQueueId={entry.queueId}
                    />
                  ))}
                  {parsedFrame.airgradientOpenAir?.map((entry, idx) => (
                    <HistoryElement
                      key={entry.queueId}
                      element={{
                        queueId: entry.queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.rawData ?? null,
                        type: getQueueType(entry.queueType),
                        queueType: entry.queueType,
                      }}
                      index={airgradientOpenAirIndex + idx}
                      dataQueueType="airgradient-open-air-o-1pst"
                      dataQueueId={entry.queueId}
                    />
                  ))}
                  {parsedFrame.victronSmartSolar?.map((entry, idx) => (
                    <HistoryElement
                      key={entry.queueId}
                      element={{
                        queueId: entry.queueId,
                        entryId: entry.ptr,
                        data: entry.data,
                        rawData: entry.rawData ?? null,
                        type: getQueueType(entry.queueType),
                        queueType: entry.queueType,
                      }}
                      index={victronSmartSolarIndex + idx}
                      dataQueueType="victron-smartsolar-mppt"
                      dataQueueId={entry.queueId}
                    />
                  ))}
                  {parsedFrame.dmesg && (
                    <HistoryElement
                      element={{
                        queueId: parsedFrame.dmesg.queueId,
                        entryId: parsedFrame.dmesg.ptr,
                        data: parsedFrame.dmesg.data,
                        rawData: parsedFrame.dmesg.rawData ?? null,
                        type: getQueueType(parsedFrame.dmesg.queueType),
                        queueType: parsedFrame.dmesg.queueType,
                      }}
                      index={dmesgIndex}
                      dataQueueType="dmesg"
                      dataQueueId={parsedFrame.dmesg.queueId}
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
                      index={yahboomDogzillaLiteIndex}
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
                      index={normvlaIndex}
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
                      index={st3215TxIndex}
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
                      index={otherEntriesIndex + idx}
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
