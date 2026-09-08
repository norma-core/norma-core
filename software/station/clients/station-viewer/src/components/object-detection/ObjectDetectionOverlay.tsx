import { useEffect, useRef, useState, type RefObject } from 'react';
import { DetectionSession, type DetectionStatus } from './detection-session';
import { imageContentRect } from './image-content-rect';
import type { DetectionFrame } from './protocol';

interface ObjectDetectionOverlayProps {
  imageRef: RefObject<HTMLImageElement | HTMLCanvasElement | null>;
  frameIdRef?: RefObject<number>;
  mirrored?: boolean;
  experimental?: boolean;
  sourceStale?: boolean;
  fit: 'contain' | 'cover';
}

export default function ObjectDetectionOverlay({ imageRef, frameIdRef, mirrored = false, experimental = false, sourceStale = false, fit }: ObjectDetectionOverlayProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<DetectionFrame | null>(null);
  const [status, setStatus] = useState<DetectionStatus | 'paused'>('loading');
  const sourceStaleRef = useRef(sourceStale);

  useEffect(() => { sourceStaleRef.current = sourceStale; }, [sourceStale]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let session: DetectionSession | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      session?.dispose();
      clearInterval(interval);
    };
    const syncVisibility = () => {
      stop();
      setFrame(null);
      if (document.visibilityState === 'hidden') { setStatus('paused'); return; }
      // A slow stream is not evidence that an object left the scene. Replace
      // boxes only when another inference completes, including empty results.
      session = new DetectionSession(setFrame, setStatus);
      interval = setInterval(() => {
        if (sourceStaleRef.current) return;
        const image = imageRef.current;
        if (image) void session?.detect(image, frameIdRef ? String(frameIdRef.current || '') : 'currentSrc' in image ? image.currentSrc : '');
      }, 350);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', syncVisibility); };
  }, [imageRef, frameIdRef]);

  const rect = frame ? imageContentRect(frame.width, frame.height, size.width, size.height, fit) : null;
  return <div ref={surface} className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Object detections">
    {frame && rect && <div className="absolute overflow-hidden" style={rect}>
      {frame.boxes.map(box => <div key={`${box.label}:${box.x}:${box.y}`} className="absolute border-2 border-cyan-300 shadow-[0_0_0_1px_#12323d]" style={{ left: `${(mirrored ? 1 - box.x - box.width : box.x) * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}>
        <span className="absolute top-0 whitespace-nowrap rounded-br bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-4 text-slate-900" style={(mirrored ? 1 - box.x - box.width : box.x) > 0.5 ? { right: 0 } : { left: 0 }}>{box.label} {Math.round(box.score * 100)}%</span>
      </div>)}
    </div>}
    <div role="status" className="absolute bottom-12 left-3 max-w-[calc(100%-1.5rem)] rounded border border-slate-300 bg-white/95 px-2 py-1 text-xs text-slate-800">
      {sourceStale ? 'Signal delayed · last detections' : status === 'loading' ? 'Loading object detection…' : status === 'error' ? 'Detection unavailable · toggle Objects to retry' : status === 'paused' ? 'Detection paused' : `Objects · ${frame ? frame.boxes.length : 'waiting for a fresh frame'}`}
      {experimental && <span className="block text-[10px]">Experimental · thermal image</span>}
    </div>
  </div>;
}
