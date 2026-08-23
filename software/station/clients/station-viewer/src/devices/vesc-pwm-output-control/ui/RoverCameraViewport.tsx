import {
  Camera,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import type { FrameEntry } from '@/api/frame-parser';
import { usbvideo } from '@/api/proto.js';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId } from '@/usbvideo/camera-source';

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

function RoverCameraViewport({
  videoSources,
  status,
  isFullscreen,
  onOpenDetails,
  onToggleFullscreen,
}: RoverCameraViewportProps) {
  const primaryCameraSourceId = videoSources[0]
    ? getVideoSourceId(videoSources[0])
    : null;

  const cameraStage = !primaryCameraSourceId ? (
    <div className="flex h-full items-center justify-center bg-surface-base text-center text-sm text-text-muted">
      <div><Camera className="mx-auto mb-3 h-7 w-7" />Waiting for rover camera</div>
    </div>
  ) : (
    <CameraPane sourceId={primaryCameraSourceId} />
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
        <div className="relative ml-auto flex shrink-0 items-center rounded-md border border-accent-data/35 bg-surface-primary/55 p-1 shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md">
          <button type="button" onClick={onToggleFullscreen} className="flex h-11 w-11 items-center justify-center rounded text-text-secondary hover:bg-accent-data/12 hover:text-accent-data lg:h-8 lg:w-8" aria-label={isFullscreen ? 'Exit fullscreen rover control' : 'Fullscreen rover control'} aria-pressed={isFullscreen}>
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoverCameraViewport;
