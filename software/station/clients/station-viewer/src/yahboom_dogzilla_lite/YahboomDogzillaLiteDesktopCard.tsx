import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const STALE_CAMERA_MAX_AGE_MS = 60_000;

type CameraLayoutMode = 'pip' | 'side-by-side' | 'stacked';
type CameraFitMode = 'contain' | 'cover';

type ActiveVideoSource = {
  id: string;
  label: string;
  shortLabel: string;
  sourceId: string;
  queueId: string;
};

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
  const hasPrimaryVideoSourcePreferenceRef = useRef(false);
  const [primaryVideoSourceId, setPrimaryVideoSourceId] = useState<string | null>(null);
  const [secondaryVideoSourceId, setSecondaryVideoSourceId] = useState<string | null>(null);
  const [mainViewMode, setMainViewMode] = useState<YahboomDogzillaLiteViewMode>('3d');
  const [cameraLayout, setCameraLayout] = useState<CameraLayoutMode>('pip');
  const [primaryCameraFit, setPrimaryCameraFit] = useState<CameraFitMode>('contain');
  const [secondaryCameraFit, setSecondaryCameraFit] = useState<CameraFitMode>('contain');
  const previousMainViewModeRef = useRef<Exclude<YahboomDogzillaLiteViewMode, 'fullscreenVideo'>>('3d');
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());

  const now = Date.now();
  const device = deviceState.device;
  const isConnected = deviceState.isConnected ?? false;

  const activeVideoSources = useMemo(() => {
    const nowMs = Date.now();

    const isFresh = (entry: FrameEntry<usbvideo.IRxEnvelope>) => {
      const monotonicStampNs = entry.data.stamp?.monotonicStampNs;
      if (!monotonicStampNs) {
        return true;
      }

      const localStampNs = serverToLocal(Long.fromValue(monotonicStampNs));
      const ageMs = nowMs - localStampNs.toNumber() / 1e6;

      return ageMs <= STALE_CAMERA_MAX_AGE_MS;
    };

    return (videoSources ?? [])
      .filter(isFresh)
      .map((entry): ActiveVideoSource | null => {
        const cameraKey = entry.data.camera?.uniqueId ?? entry.queueId;
        if (!cameraKey) {
          return null;
        }

        return {
          id: `usbvideo:${cameraKey}`,
          label: getVideoSourceLabel(entry),
          shortLabel: entry.data.camera?.deviceNumber !== undefined
            ? String(entry.data.camera.deviceNumber)
            : entry.data.camera?.product || 'Camera',
          sourceId: getVideoSourceId(entry),
          queueId: entry.queueId
        };
      })
      .filter((entry): entry is ActiveVideoSource => Boolean(entry));
  }, [videoSources]);

  const activeVideoSourceIds = useMemo(
    () => activeVideoSources.map((entry) => entry.id),
    [activeVideoSources]
  );
  const firstActiveVideoSourceId = activeVideoSourceIds[0] ?? null;

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

  const primaryVideoSource = activeVideoSources.find((entry) => entry.id === primaryVideoSourceId) ?? null;
  const secondaryVideoSource = activeVideoSources.find((entry) => entry.id === secondaryVideoSourceId) ?? null;

  useEffect(() => {
    if (primaryVideoSourceId && !activeVideoSourceIds.includes(primaryVideoSourceId)) {
      setPrimaryVideoSourceId(null);
      hasPrimaryVideoSourcePreferenceRef.current = false;
    }

    if (
      !primaryVideoSourceId &&
      firstActiveVideoSourceId &&
      !hasPrimaryVideoSourcePreferenceRef.current
    ) {
      setPrimaryVideoSourceId(firstActiveVideoSourceId);
    }

    if (
      secondaryVideoSourceId &&
      (!activeVideoSourceIds.includes(secondaryVideoSourceId) || secondaryVideoSourceId === primaryVideoSourceId)
    ) {
      setSecondaryVideoSourceId(null);
    }
  }, [
    activeVideoSourceIds,
    firstActiveVideoSourceId,
    primaryVideoSourceId,
    secondaryVideoSourceId
  ]);

  useEffect(() => {
    if (!primaryVideoSource && (mainViewMode === 'photo' || mainViewMode === 'fullscreenVideo')) {
      exitFullscreen();
      previousMainViewModeRef.current = '3d';
      setMainViewMode('3d');
    }
  }, [mainViewMode, primaryVideoSource]);

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

  const handleMainViewModeChange = useCallback((value: YahboomDogzillaLiteViewMode) => {
    if ((value === 'photo' || value === 'fullscreenVideo') && !primaryVideoSource) {
      return;
    }

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
  }, [primaryVideoSource]);

  const handlePrimaryVideoSourceChange = useCallback((sourceId: string | null) => {
    hasPrimaryVideoSourcePreferenceRef.current = true;
    setPrimaryVideoSourceId(sourceId);
    if (sourceId && sourceId === secondaryVideoSourceId) {
      setSecondaryVideoSourceId(null);
    }
  }, [secondaryVideoSourceId]);

  const handleCameraChipClick = useCallback((sourceId: string) => {
    if (sourceId === primaryVideoSourceId) {
      hasPrimaryVideoSourcePreferenceRef.current = true;
      setPrimaryVideoSourceId(secondaryVideoSourceId);
      setSecondaryVideoSourceId(null);
      return;
    }

    if (sourceId === secondaryVideoSourceId) {
      setSecondaryVideoSourceId(null);
      return;
    }

    if (!primaryVideoSourceId) {
      hasPrimaryVideoSourcePreferenceRef.current = true;
      setPrimaryVideoSourceId(sourceId);
      return;
    }

    setSecondaryVideoSourceId(sourceId);
  }, [primaryVideoSourceId, secondaryVideoSourceId]);

  const handleSwapVideoSources = useCallback(() => {
    if (!primaryVideoSourceId || !secondaryVideoSourceId) {
      return;
    }

    setPrimaryVideoSourceId(secondaryVideoSourceId);
    setSecondaryVideoSourceId(primaryVideoSourceId);
    hasPrimaryVideoSourcePreferenceRef.current = true;
  }, [primaryVideoSourceId, secondaryVideoSourceId]);

  const handleToggleFullscreenMode = useCallback(() => {
    handleMainViewModeChange(mainViewMode === 'fullscreenVideo'
      ? previousMainViewModeRef.current
      : 'fullscreenVideo');
  }, [handleMainViewModeChange, mainViewMode]);

  const latencyLabel = latencyAvg.avg < 1000
    ? `${latencyAvg.avg.toFixed(0)}ms`
    : `${(latencyAvg.avg / 1000).toFixed(1)}s`;
  const hasMultipleVideoSources = activeVideoSources.length > 1;
  const cameraSelectValue = primaryVideoSourceId ?? '';
  const cameraSelectLabel = activeVideoSources.length === 0 ? 'No Video' : 'None';

  return (
    <div className="mx-auto flex h-[min(86vh,58rem)] min-h-[46rem] w-full min-w-[300px] max-w-[1536px] flex-col overflow-hidden rounded-lg border border-border-default bg-surface-primary/50 lg:col-span-2">
      <div className="grid min-h-14 grid-cols-[minmax(13rem,auto)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border-default bg-surface-secondary/45 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getLatencyBgColor(latency, !isConnected)}`} />
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-accent-data">
              {device?.serialNumber ? `Dogzilla #${device.serialNumber}` : 'Dogzilla Lite'}
            </div>
            <div className="mt-0.5 truncate text-xs text-text-muted">
              {device?.portName || 'No port'}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <YahboomDogzillaLiteViewModeSwitch
            value={mainViewMode}
            onChange={handleMainViewModeChange}
            photoDisabled={!primaryVideoSource}
          />
          {hasMultipleVideoSources && (mainViewMode === 'photo' || mainViewMode === 'fullscreenVideo') ? (
            <div
              className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto py-0.5"
              role="group"
              aria-label="Camera selection"
            >
              {activeVideoSources.length === 0 ? (
                <span className="h-9 rounded-lg border border-border-subtle bg-surface-primary px-3 py-2 text-sm font-medium text-text-muted">
                  No cameras
                </span>
              ) : activeVideoSources.map((entry) => {
                const role =
                  entry.id === primaryVideoSourceId
                    ? 'MAIN'
                    : entry.id === secondaryVideoSourceId
                      ? 'AUX'
                      : null;
                const chipTitle =
                  role === 'MAIN'
                    ? `MAIN: ${entry.label}. Click to clear; AUX becomes MAIN.`
                    : role === 'AUX'
                      ? `AUX: ${entry.label}. Click to clear.`
                      : primaryVideoSourceId
                        ? `Select ${entry.label} as AUX camera.`
                        : `Select ${entry.label} as MAIN camera.`;

                return (
                  <button
                    key={`${entry.queueId}-${entry.id}`}
                    type="button"
                    onClick={() => handleCameraChipClick(entry.id)}
                    className={`flex h-9 max-w-[9rem] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-bold transition-colors ${
                      role === 'MAIN'
                        ? 'border-accent-data bg-accent-data text-surface-base'
                        : role === 'AUX'
                          ? 'border-accent-success-deep bg-accent-success-bg text-text-primary'
                          : 'border-border-subtle bg-surface-primary text-text-muted hover:text-text-primary'
                    }`}
                    title={chipTitle}
                    aria-label={role ? `${role} camera ${entry.label}` : `Select camera ${entry.label}`}
                  >
                    <span className="truncate">{entry.shortLabel}</span>
                    {role && (
                      <span className="rounded bg-black/20 px-1 py-0.5 text-[10px] leading-none">
                        {role}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : hasMultipleVideoSources ? (
            <select
              value={cameraSelectValue}
              onChange={(event) => handlePrimaryVideoSourceChange(event.target.value || null)}
              className="h-9 min-w-0 max-w-[16rem] rounded-lg border border-border-subtle bg-surface-primary px-3 pr-9 text-sm font-medium text-text-primary focus:border-accent-data focus:outline-none focus:ring-1 focus:ring-accent-data"
              title="Main camera"
            >
              <option value="">{cameraSelectLabel}</option>
              {activeVideoSources.map((entry) => (
                <option key={`${entry.queueId}-${entry.id}`} value={entry.id} title={entry.label}>
                  {entry.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-md border border-border-default bg-surface-primary px-2.5 py-1.5 font-mono text-xs text-text-secondary">
            {isConnected ? (
              <span className={getLatencyTextColor(latency)}>{latencyLabel}</span>
            ) : (
              <span className="text-accent-critical">offline</span>
            )}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <YahboomDogzillaLiteDesktopDashboard
          deviceState={deviceState}
          refreshToken={deviceIndex}
          primaryCameraSourceId={primaryVideoSource?.sourceId ?? null}
          secondaryCameraSourceId={secondaryVideoSource?.sourceId ?? null}
          mainViewMode={mainViewMode}
          cameraLayout={cameraLayout}
          primaryCameraFit={primaryCameraFit}
          secondaryCameraFit={secondaryCameraFit}
          onPrimaryCameraFitToggle={() => setPrimaryCameraFit((fit) => (fit === 'contain' ? 'cover' : 'contain'))}
          onSecondaryCameraFitToggle={() => setSecondaryCameraFit((fit) => (fit === 'contain' ? 'cover' : 'contain'))}
          onSetPipLayout={() => setCameraLayout('pip')}
          onToggleSplitLayout={() => setCameraLayout((layout) => (layout === 'side-by-side' ? 'stacked' : 'side-by-side'))}
          onSwapCameras={handleSwapVideoSources}
          onToggleFullscreen={handleToggleFullscreenMode}
        />
      </div>
    </div>
  );
});

export default YahboomDogzillaLiteDesktopCard;
