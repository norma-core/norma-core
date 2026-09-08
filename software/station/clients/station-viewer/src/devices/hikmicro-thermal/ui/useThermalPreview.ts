import { useEffect, useRef, useState, type RefObject } from 'react';
import type { hikmicro } from '@/api/proto.js';
import { ThermalFrameRenderer } from '../thermal-renderer';
import type { ThermalPalette, ThermalRenderResult } from '../thermal';

type ThermalStats = Omit<ThermalRenderResult, 'rgba'>;

export function useThermalPreview(data: hikmicro.IRxEnvelope, frame: hikmicro.IThermalFrame | null, palette: ThermalPalette, canvasRef: RefObject<HTMLCanvasElement | null>) {
  const rendererRef = useRef<ThermalFrameRenderer | null>(null);
  const renderedFrameRef = useRef(0);
  const latestRef = useRef({ data, frame, palette });
  const lastInputAtRef = useRef(performance.now());
  const [stats, setStats] = useState<ThermalStats | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latestRef.current.frame !== frame) lastInputAtRef.current = performance.now();
    latestRef.current = { data, frame, palette };
    if (frame) rendererRef.current?.render(data, frame, palette);
  }, [data, frame, palette]);

  useEffect(() => {
    let animation: number | null = null;
    let pending: ThermalRenderResult | null = null;
    let lastStatsAt = -Infinity;
    const stop = () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
      pending = null;
    };
    const syncVisibility = () => {
      stop();
      if (document.visibilityState === 'hidden') return;
      lastStatsAt = -Infinity;
      rendererRef.current = new ThermalFrameRenderer(result => {
        pending = result;
        if (animation !== null) return;
        animation = requestAnimationFrame(() => {
          animation = null;
          const rendered = pending;
          pending = null;
          const canvas = canvasRef.current;
          if (!canvas || !rendered) return;
          if (canvas.width !== rendered.width) canvas.width = rendered.width;
          if (canvas.height !== rendered.height) canvas.height = rendered.height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) { setError('Canvas unavailable'); return; }
          // Transferred pixels are already owned by this thread: no extra pixel
          // copy and no canvas backing-store reset on every frame.
          ctx.putImageData(new ImageData(rendered.rgba as Uint8ClampedArray<ArrayBuffer>, rendered.width, rendered.height), 0, 0);
          renderedFrameRef.current += 1;
          setError(null);
          const now = performance.now();
          setStale(now - lastInputAtRef.current > 5000);
          if (now - lastStatsAt >= 250) {
            const { rgba: _rgba, ...nextStats } = rendered;
            setStats(nextStats);
            lastStatsAt = now;
          }
        });
      }, message => {
        if (animation !== null) cancelAnimationFrame(animation);
        animation = null;
        pending = null;
        setError(message);
      });
      const latest = latestRef.current;
      if (latest.frame) rendererRef.current.render(latest.data, latest.frame, latest.palette);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    const freshnessTimer = setInterval(() => setStale(performance.now() - lastInputAtRef.current > 5000), 1000);
    return () => {
      stop();
      clearInterval(freshnessTimer);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [canvasRef]);
  return { stats, stale, error, renderedFrameRef };
}
