import { useEffect, useRef, useState, type RefObject } from 'react';
import type { hikmicro } from '@/api/proto.js';
import { ThermalFrameRenderer } from '../thermal-renderer';
import type { ThermalPalette, ThermalRenderResult } from '../thermal';

type ThermalStats = Omit<ThermalRenderResult, 'rgba' | 'contours'>;

export function useThermalPreview(data: hikmicro.IRxEnvelope, frame: hikmicro.IThermalFrame | null, palette: ThermalPalette, canvasRef: RefObject<HTMLCanvasElement | null>, contourRef: RefObject<HTMLCanvasElement | null>, showContours: boolean) {
  const rendererRef = useRef<ThermalFrameRenderer | null>(null);
  const latestRef = useRef({ data, frame, palette, showContours });
  const lastInputAtRef = useRef(performance.now());
  const [stats, setStats] = useState<ThermalStats | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latestRef.current.frame !== frame) lastInputAtRef.current = performance.now();
    latestRef.current = { data, frame, palette, showContours };
    if (frame) rendererRef.current?.render(data, frame, palette, showContours);
  }, [data, frame, palette, showContours]);

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
          const overlay = contourRef.current;
          if (overlay && rendered.contours) {
            // Draw the matching field and pixels together. A small fixed backing
            // store keeps lines antialiased without allocating a screen-size canvas.
            if (overlay.width !== rendered.width * 3) overlay.width = rendered.width * 3;
            if (overlay.height !== rendered.height * 3) overlay.height = rendered.height * 3;
            const lines = overlay.getContext('2d');
            if (lines) {
              lines.setTransform(3, 0, 0, 3, 0, 0);
              lines.clearRect(0, 0, rendered.width, rendered.height);
              const segments = rendered.contours;
              if (segments?.length) {
                lines.beginPath();
                for (let i = 0; i < segments.length; i += 4) {
                  lines.moveTo(segments[i], segments[i + 1]);
                  lines.lineTo(segments[i + 2], segments[i + 3]);
                }
                lines.lineCap = 'round';
                lines.lineWidth = 0.8;
                lines.strokeStyle = 'rgba(8, 35, 45, 0.45)';
                lines.stroke();
                lines.lineWidth = 0.35;
                lines.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                lines.stroke();
              }
            }
          } else if (overlay && overlay.width !== 1) {
            overlay.width = overlay.height = 1;
          }
          setError(null);
          const now = performance.now();
          setStale(now - lastInputAtRef.current > 5000);
          if (now - lastStatsAt >= 250) {
            const { rgba: _rgba, contours: _contours, ...nextStats } = rendered;
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
      if (latest.frame) rendererRef.current.render(latest.data, latest.frame, latest.palette, latest.showContours);
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    const freshnessTimer = setInterval(() => setStale(performance.now() - lastInputAtRef.current > 5000), 1000);
    return () => {
      stop();
      clearInterval(freshnessTimer);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [canvasRef, contourRef]);
  return { stats, stale, error };
}
