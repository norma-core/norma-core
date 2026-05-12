import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import type { FrameEntry } from '@/api/frame-parser';
import { serverToLocal } from '@/api/timestamp-utils';
import { yahboom_dogzilla_lite, usbvideo } from '@/api/proto.js';
import YahboomDogzillaLiteDesktopDashboard from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopDashboard';
import YahboomDogzillaLiteViewModeSwitch, { type YahboomDogzillaLiteViewMode } from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewModeSwitch';
import { getVideoSourceId, getVideoSourceLabel } from '@/usbvideo/camera-source';
import { getLatencyBgColor, getLatencyTextColor } from '@/utils/color-utils';

interface LatencyReading {
  timestamp: number;
  latency: number;
}

interface LatencyStats {
  avg: number;
  min: number;
  max: number;
}

const exitFullscreen = () => {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
};

interface YahboomDogzillaLiteDesktopCardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState;
  deviceIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
}

const YahboomDogzillaLiteDesktopCard = memo(function YahboomDogzillaLiteDesktopCard({
  deviceState,
  deviceIndex,
  videoSources
}: YahboomDogzillaLiteDesktopCardProps) {
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState('');
  const [mainViewMode, setMainViewMode] = useState<YahboomDogzillaLiteViewMode>('3d');
  const previousMainViewModeRef = useRef<Exclude<YahboomDogzillaLiteViewMode, 'fullscreenVideo'>>('3d');
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());

  const now = Date.now();
  const device = deviceState.device;
  const isConnected = deviceState.isConnected ?? false;
  const usbVideoSources = useMemo(() => videoSources ?? [], [videoSources]);

  const getMovingAverageLatency = (key: string, currentLatency: number): LatencyStats => {
    const validLatency = Math.max(0, currentLatency);
    const history = latencyHistoryRef.current.get(key) || [];

    history.push({ timestamp: now, latency: validLatency });
    const filtered = history.filter((reading) => now - reading.timestamp <= 15000);
    latencyHistoryRef.current.set(key, filtered);

    if (filtered.length === 0) {
      return { avg: validLatency, min: validLatency, max: validLatency };
    }

    const latencies = filtered.map((reading) => reading.latency);
    const sum = latencies.reduce((acc, latency) => acc + latency, 0);

    return {
      avg: sum / filtered.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies)
    };
  };

  const adjustedStamp = deviceState.monotonicStampNs
    ? serverToLocal(Long.fromValue(deviceState.monotonicStampNs))
    : null;
  const latency = adjustedStamp ? now - adjustedStamp.toNumber() / 1e6 : 0;
  const latencyAvg = getMovingAverageLatency(`yahboom_dogzilla_lite-${deviceIndex}`, latency);

  const selectedVideoSource = (() => {
    if (selectedVideoSourceId.startsWith('usbvideo:')) {
      const id = selectedVideoSourceId.replace('usbvideo:', '');
      const entry = usbVideoSources.find((videoEntry) => videoEntry.data.camera?.uniqueId === id);
      return entry
        ? { kind: 'usbvideo' as const, source: entry.data, sourceId: getVideoSourceId(entry) }
        : undefined;
    }

    return undefined;
  })();

  useEffect(() => {
    if (selectedVideoSourceId) {
      return;
    }

    const options: string[] = [];
    usbVideoSources.forEach((entry) => {
      if (entry.data.camera?.uniqueId) {
        options.push(`usbvideo:${entry.data.camera.uniqueId}`);
      }
    });

    if (options.length === 1) {
      setSelectedVideoSourceId(options[0]);
    }
  }, [selectedVideoSourceId, usbVideoSources]);

  useEffect(() => {
    if (!selectedVideoSource && (mainViewMode === 'photo' || mainViewMode === 'fullscreenVideo')) {
      exitFullscreen();
      previousMainViewModeRef.current = '3d';
      setMainViewMode('3d');
    }
  }, [mainViewMode, selectedVideoSource]);

  useEffect(() => {
    if (mainViewMode !== 'fullscreenVideo') {
      previousMainViewModeRef.current = mainViewMode;
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      exitFullscreen();
      setMainViewMode(previousMainViewModeRef.current);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mainViewMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && mainViewMode === 'fullscreenVideo') {
        setMainViewMode(previousMainViewModeRef.current);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [mainViewMode]);

  const handleMainViewModeChange = (value: YahboomDogzillaLiteViewMode) => {
    if (value === 'fullscreenVideo') {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => {
          setMainViewMode(previousMainViewModeRef.current);
        });
      }
      setMainViewMode(value);
      return;
    }

    previousMainViewModeRef.current = value;
    exitFullscreen();
    setMainViewMode(value);
  };

  return (
    <div className="mx-auto flex h-[min(86vh,58rem)] min-h-[46rem] w-full min-w-[300px] max-w-[1536px] flex-col overflow-hidden rounded-lg border border-border-default bg-surface-primary/50 lg:col-span-2">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-t-lg border-b border-border-default bg-surface-secondary/50 px-4 py-2 sm:items-center">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <span className="text-lg font-bold text-accent-data">
            {device?.serialNumber ? `#${device.serialNumber}` : 'YahboomDogzillaLite'}
          </span>
          <YahboomDogzillaLiteViewModeSwitch
            value={mainViewMode}
            onChange={handleMainViewModeChange}
            photoDisabled={!selectedVideoSource}
          />
          <select
            value={selectedVideoSourceId}
            onChange={(event) => setSelectedVideoSourceId(event.target.value)}
            className="block max-w-[180px] rounded-md border-border-subtle bg-surface-secondary py-1 pl-3 pr-10 text-base text-text-primary focus:border-accent-success-deep focus:outline-none focus:ring-accent-success-deep sm:text-sm"
          >
            <option value="">No Video</option>
            {usbVideoSources.map((entry) => {
              if (!entry.data.camera?.uniqueId) {
                return null;
              }
              return (
                <option key={`usbvideo-${entry.data.camera.uniqueId}`} value={`usbvideo:${entry.data.camera.uniqueId}`}>
                  {getVideoSourceLabel(entry)}
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Port:</span>
            <span className="text-accent-data">{device?.portName || 'N/A'}</span>
          </div>
          {isConnected ? (
            <span className={getLatencyTextColor(latency)}>
              {latencyAvg.avg < 1000
                ? `${latencyAvg.avg.toFixed(0)}ms`
                : `${(latencyAvg.avg / 1000).toFixed(1)}s`}
            </span>
          ) : (
            <span className="text-accent-critical">Disconnected</span>
          )}
          <span className={`h-3 w-3 rounded-full ${getLatencyBgColor(latency, !isConnected)}`}></span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <YahboomDogzillaLiteDesktopDashboard
          deviceState={deviceState}
          refreshToken={deviceIndex}
          selectedVideoSource={selectedVideoSource}
          mainViewMode={mainViewMode}
        />
      </div>
    </div>
  );
});

export default YahboomDogzillaLiteDesktopCard;
