import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Camera,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { commandManager } from '@/api/commands.js';
import type { FrameEntry } from '@/api/frame-parser';
import { usbvideo } from '@/api/proto.js';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId } from '@/usbvideo/camera-source';
import {
  clearLiveCameraFrame,
  resumeLiveCameraFrame,
  suppressLiveCameraFrame,
} from '@/usbvideo/live-camera-store';

interface RoverCameraStatus {
  ready: boolean;
  hasFault: boolean;
  boardLabel: string;
  outputLabel: string;
}

interface RoverCameraViewportProps {
  videoSources: FrameEntry<usbvideo.IRxEnvelope>[];
  controlVideoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  status: RoverCameraStatus;
  isFullscreen: boolean;
  onOpenDetails: () => void;
  onToggleFullscreen: () => void;
}

function CameraPane({ sourceId }: { sourceId: string }) {
  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-black">
      <CameraViewer
        sourceId={sourceId}
        className="h-full w-full"
        imageClassName="select-none"
        fit="cover"
        overlay="none"
      />
    </div>
  );
}

function bytesToHex(bytes?: Uint8Array | null): string {
  if (!bytes || bytes.length === 0) return '';
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fourccToString(fourcc?: number | null): string {
  if (!fourcc) return '????';
  return [24, 16, 8, 0]
    .map((shift) => String.fromCharCode((fourcc >>> shift) & 0xff))
    .join('')
    .trim();
}

function fpsLabel(fps?: number | null): string {
  if (!Number.isFinite(fps)) return '? fps';
  return `${Number(fps).toFixed(2)} fps`;
}

function formatKey(format: usbvideo.ICameraFormat): string {
  return [
    format.fourcc ?? 0,
    format.index ?? 0,
    format.width ?? 0,
    format.height ?? 0,
    Number(format.framesPerSecond ?? 0).toPrecision(8),
    bytesToHex(format.guid),
    format.frameIndex ?? 0,
  ].join(':');
}

function formatLabel(format: usbvideo.ICameraFormat): string {
  return [
    fourccToString(format.fourcc),
    `${format.width ?? 0}x${format.height ?? 0}`,
    fpsLabel(format.framesPerSecond),
  ].join(' ');
}

function uniqueFormats(formats: usbvideo.ICameraFormat[] | null | undefined) {
  const seen = new Set<string>();
  return (formats ?? []).flatMap((format) => {
    const key = formatKey(format);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, format }];
  });
}

function RoverCameraViewport({
  videoSources,
  controlVideoSources = videoSources,
  status,
  isFullscreen,
  onOpenDetails,
  onToggleFullscreen,
}: RoverCameraViewportProps) {
  const primaryVideoSource = videoSources[0] ?? null;
  const primaryControlVideoSource = primaryVideoSource ?? controlVideoSources[0] ?? null;
  const liveCameraSourceId = primaryVideoSource
    ? getVideoSourceId(primaryVideoSource)
    : null;
  const lastKnownCameraSourceId = controlVideoSources[0]
    ? getVideoSourceId(controlVideoSources[0])
    : null;
  const cameraPaneSourceId = liveCameraSourceId ?? lastKnownCameraSourceId;
  const primaryCameraUniqueId = primaryControlVideoSource?.data.camera?.uniqueId ?? '';
  const cameraFormats = useMemo(
    () => uniqueFormats(primaryControlVideoSource?.data.formats),
    [primaryControlVideoSource?.data.formats],
  );
  const [selectedFormatKey, setSelectedFormatKey] = useState('auto');

  useEffect(() => {
    if (selectedFormatKey === 'auto' || selectedFormatKey === 'none') return;
    if (cameraFormats.some((format) => format.key === selectedFormatKey)) return;
    setSelectedFormatKey('auto');
  }, [cameraFormats, selectedFormatKey]);

  useEffect(() => {
    setSelectedFormatKey('auto');
  }, [primaryCameraUniqueId]);

  const handleFormatChange = useCallback((nextFormatKey: string) => {
    setSelectedFormatKey(nextFormatKey);
    if (cameraPaneSourceId) {
      if (nextFormatKey === 'none') {
        suppressLiveCameraFrame(cameraPaneSourceId);
      } else {
        resumeLiveCameraFrame(cameraPaneSourceId);
        clearLiveCameraFrame(cameraPaneSourceId);
      }
    }
    if (!primaryCameraUniqueId) return;

    if (nextFormatKey === 'auto') {
      void commandManager.sendUsbVideoCommand({
        targetCameraUniqueId: primaryCameraUniqueId,
        setFormat: {
          mode: usbvideo.SetFormatMode.SET_FORMAT_MODE_AUTO,
        },
      }).catch((error) => {
        console.error('Failed to send USB video auto format command', error);
      });
      return;
    }

    if (nextFormatKey === 'none') {
      void commandManager.sendUsbVideoCommand({
        targetCameraUniqueId: primaryCameraUniqueId,
        setFormat: {
          mode: usbvideo.SetFormatMode.SET_FORMAT_MODE_NONE,
        },
      }).catch((error) => {
        console.error('Failed to send USB video none format command', error);
      });
      return;
    }

    const selectedFormat = cameraFormats.find((format) => format.key === nextFormatKey)?.format;
    if (!selectedFormat) return;

    void commandManager.sendUsbVideoCommand({
      targetCameraUniqueId: primaryCameraUniqueId,
      setFormat: {
        mode: usbvideo.SetFormatMode.SET_FORMAT_MODE_MANUAL,
        format: selectedFormat,
      },
    }).catch((error) => {
      console.error('Failed to send USB video manual format command', error);
    });
  }, [cameraFormats, cameraPaneSourceId, primaryCameraUniqueId]);

  const cameraStage = !cameraPaneSourceId ? (
    <div className="flex h-full items-center justify-center bg-surface-base text-center text-sm text-text-muted">
      <div><Camera className="mx-auto mb-3 h-7 w-7" />Waiting for rover camera</div>
    </div>
  ) : (
    <CameraPane sourceId={cameraPaneSourceId} />
  );

  return (
    <div className="relative min-h-0 overflow-hidden bg-black [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0">
      {cameraStage}
      <div className="pointer-events-none absolute inset-0 z-10 hidden [background:radial-gradient(circle_at_18%_82%,rgba(34,211,238,0.14),transparent_27%),radial-gradient(circle_at_84%_78%,rgba(34,211,238,0.10),transparent_24%),linear-gradient(90deg,rgba(0,0,0,0.30),transparent_32%,transparent_68%,rgba(0,0,0,0.30)),linear-gradient(180deg,rgba(0,0,0,0.18),transparent_34%,rgba(0,0,0,0.22))] [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden="true" />
      <span className="pointer-events-none absolute left-[0.55rem] top-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-l-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
      <span className="pointer-events-none absolute right-[0.55rem] top-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-r-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
      <span className="pointer-events-none absolute bottom-[0.55rem] left-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-b-2 border-l-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
      <span className="pointer-events-none absolute bottom-[0.55rem] right-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-b-2 border-r-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
      <div className="absolute left-2 right-2 top-2 z-40 flex items-start justify-between gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:left-[calc(0.5rem+env(safe-area-inset-left))] [@media(max-width:1023px)_and_(orientation:landscape)]:right-[calc(0.5rem+env(safe-area-inset-right))] [@media(max-width:1023px)_and_(orientation:landscape)]:top-[calc(0.5rem+env(safe-area-inset-top))]">
        <button type="button" onClick={onOpenDetails} aria-label="Open rover status" className="flex min-w-0 items-center gap-2 rounded-md border border-accent-data/35 bg-surface-primary/55 px-2.5 py-2 text-left shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md transition hover:border-accent-data/60 hover:bg-surface-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-data [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
          <span className={`h-2 w-2 shrink-0 rounded-full ${status.ready ? 'bg-accent-success' : status.hasFault ? 'bg-accent-critical' : 'bg-accent-warning'}`} />
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-text-primary">Rover</div>
            <div className="max-w-28 truncate font-mono text-[8px] uppercase tracking-wide text-text-muted">
              {status.boardLabel || 'no drive'} · {status.outputLabel || 'no steering'}
            </div>
          </div>
        </button>
        <div className="relative ml-auto flex min-w-0 shrink items-center gap-1 rounded-md border border-accent-data/35 bg-surface-primary/55 p-1 shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md">
          {primaryCameraUniqueId && (
            <label className="min-w-0">
              <span className="sr-only">Camera format</span>
              <select
                value={selectedFormatKey}
                onChange={(event) => handleFormatChange(event.target.value)}
                className="h-11 max-w-[min(13rem,54vw)] rounded border border-accent-data/20 bg-surface-secondary/75 px-2 pr-7 font-mono text-[10px] font-semibold text-text-primary outline-none transition focus:border-accent-data focus:ring-1 focus:ring-accent-data lg:h-8 lg:max-w-[16rem] lg:text-[11px]"
                title="Camera format"
              >
                <option value="auto">Auto</option>
                <option value="none">None</option>
                {cameraFormats.map(({ key, format }) => (
                  <option key={key} value={key}>
                    {formatLabel(format)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={onToggleFullscreen} className="flex h-11 w-11 items-center justify-center rounded text-text-secondary hover:bg-accent-data/12 hover:text-accent-data lg:h-8 lg:w-8" aria-label={isFullscreen ? 'Exit fullscreen rover control' : 'Fullscreen rover control'} aria-pressed={isFullscreen}>
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoverCameraViewport;
