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
import type { FrameEntry } from '@/api/frame-parser';
import { usbvideo } from '@/api/proto.js';
import CameraViewer from '@/usbvideo/CameraViewer';
import CameraLayoutControls, { type CameraLayoutMode } from '@/usbvideo/CameraLayoutControls';
import { getVideoSourceId, getVideoSourceLabel } from '@/usbvideo/camera-source';

interface CameraOption {
  id: string;
  label: string;
  sourceId: string;
}

interface RoverCameraStatus {
  ready: boolean;
  hasFault: boolean;
  boardLabel: string;
  outputLabel: string;
}

interface RoverCameraViewportProps {
  videoSources: FrameEntry<usbvideo.IRxEnvelope>[];
  status: RoverCameraStatus;
  isFullscreen: boolean;
  onOpenDetails: () => void;
  onToggleFullscreen: () => void;
}

function CameraPane({ camera }: { camera: CameraOption }) {
  return (
    <figure className="relative h-full min-h-0 min-w-0 overflow-hidden bg-black">
      <CameraViewer
        sourceId={camera.sourceId}
        className="h-full w-full"
        imageClassName="select-none"
        fit="cover"
        overlay="none"
      />
      <figcaption className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-md border border-border-default bg-surface-primary/62 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-text-secondary shadow-sm backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:bottom-[calc(0.5rem+env(safe-area-inset-bottom))] [@media(max-width:1023px)_and_(orientation:landscape)]:left-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[42%] [@media(max-width:1023px)_and_(orientation:landscape)]:-translate-x-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30">
        {camera.label}
      </figcaption>
    </figure>
  );
}

function RoverCameraViewport({
  videoSources,
  status,
  isFullscreen,
  onOpenDetails,
  onToggleFullscreen,
}: RoverCameraViewportProps) {
  const cameraOptions = useMemo<CameraOption[]>(() => videoSources.map((entry) => ({
    id: getVideoSourceId(entry),
    sourceId: getVideoSourceId(entry),
    label: getVideoSourceLabel(entry),
  })), [videoSources]);
  const [primaryCameraId, setPrimaryCameraId] = useState('');
  const [secondaryCameraId, setSecondaryCameraId] = useState('');
  const [cameraLayout, setCameraLayout] = useState<CameraLayoutMode>('pip');

  const primaryCamera = cameraOptions.find((camera) => camera.id === primaryCameraId)
    ?? cameraOptions[0]
    ?? null;
  const secondaryCamera = cameraOptions.find((camera) => camera.id === secondaryCameraId)
    ?? cameraOptions.find((camera) => camera.id !== primaryCamera?.id)
    ?? null;

  useEffect(() => {
    const ids = cameraOptions.map((camera) => camera.id);
    const primary = ids.includes(primaryCameraId) ? primaryCameraId : ids[0] ?? '';
    if (primary !== primaryCameraId) setPrimaryCameraId(primary);
    if (!ids.includes(secondaryCameraId) || secondaryCameraId === primary) {
      setSecondaryCameraId(ids.find((id) => id !== primary) ?? '');
    }
  }, [cameraOptions, primaryCameraId, secondaryCameraId]);

  const handlePrimaryCameraChange = useCallback((nextId: string) => {
    if (nextId === secondaryCamera?.id) setSecondaryCameraId(primaryCamera?.id ?? '');
    setPrimaryCameraId(nextId);
  }, [primaryCamera?.id, secondaryCamera?.id]);

  const swapCameras = useCallback(() => {
    if (!primaryCamera || !secondaryCamera) return;
    setPrimaryCameraId(secondaryCamera.id);
    setSecondaryCameraId(primaryCamera.id);
  }, [primaryCamera, secondaryCamera]);

  const cameraStage = !primaryCamera ? (
    <div className="flex h-full items-center justify-center bg-surface-base text-center text-sm text-text-muted">
      <div><Camera className="mx-auto mb-3 h-7 w-7" />Waiting for rover camera</div>
    </div>
  ) : secondaryCamera && cameraLayout !== 'pip' ? (
    <div className={`grid h-full gap-px bg-border-default ${cameraLayout === 'stacked' ? 'grid-rows-2' : 'grid-cols-2'}`}>
      <CameraPane camera={primaryCamera} />
      <CameraPane camera={secondaryCamera} />
    </div>
  ) : (
    <div className="relative h-full">
      <CameraPane camera={primaryCamera} />
      {secondaryCamera && (
        <div className="absolute bottom-3 right-3 z-20 h-[32%] min-h-20 w-[36%] min-w-28 overflow-hidden rounded-lg border border-accent-data/35 bg-surface-base shadow-[0_1rem_2.5rem_rgba(0,0,0,0.28)]">
          <CameraPane camera={secondaryCamera} />
        </div>
      )}
    </div>
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
        <button type="button" onClick={onOpenDetails} aria-label="Open rover status" className="flex min-w-0 items-center gap-2 rounded-md border border-accent-data/35 bg-surface-primary/55 px-2.5 py-2 text-left shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md transition hover:border-accent-data/60 hover:bg-surface-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-data">
          <span className={`h-2 w-2 shrink-0 rounded-full ${status.ready ? 'bg-accent-success' : status.hasFault ? 'bg-accent-critical' : 'bg-accent-warning'}`} />
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-text-primary">Rover</div>
            <div className="max-w-28 truncate font-mono text-[8px] uppercase tracking-wide text-text-muted">
              {status.boardLabel || 'no drive'} · {status.outputLabel || 'no steering'}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-accent-data/35 bg-surface-primary/55 p-1 shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md">
          {cameraOptions.length > 1 ? (
            <select
              aria-label="Main camera"
              value={primaryCamera?.id ?? ''}
              onChange={(event) => handlePrimaryCameraChange(event.target.value)}
              className="h-8 max-w-24 rounded border-0 bg-surface-secondary px-2 font-mono text-[9px] font-bold text-text-primary outline-none"
            >
              {cameraOptions.map((camera, index) => <option key={camera.id} value={camera.id}>CAM {index + 1}</option>)}
            </select>
          ) : <span className="px-2 font-mono text-[9px] font-bold text-text-secondary">CAM {cameraOptions.length || '--'}</span>}
          {secondaryCamera && (
            <CameraLayoutControls
              cameraLayout={cameraLayout}
              canSwapCameras
              onCameraLayoutChange={setCameraLayout}
              onSwapCameras={swapCameras}
            />
          )}
          <button type="button" onClick={onToggleFullscreen} className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-accent-data/12 hover:text-accent-data" aria-label={isFullscreen ? 'Exit fullscreen rover control' : 'Fullscreen rover control'} aria-pressed={isFullscreen}>
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoverCameraViewport;
