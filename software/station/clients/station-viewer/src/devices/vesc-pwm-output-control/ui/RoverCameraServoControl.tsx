import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useConnectionStats } from '@/hooks';
import { CAMERA_MAX_DEG, CAMERA_MIN_DEG, clampCameraAngle, setCameraAngle } from '../camera-servo';

const buttonClass = 'min-h-11 rounded border border-accent-data/30 bg-surface-secondary/80 px-1 font-mono text-[10px] font-bold text-text-primary hover:bg-accent-data/20 focus-visible:outline-2 focus-visible:outline-accent-data disabled:opacity-40';

export default function RoverCameraServoControl() {
  const connection = useConnectionStats();
  const [angle, setAngle] = useState(0);
  const [sentAngle, setSentAngle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const disabled = busy || connection.status !== 'connected' || connection.acquisitionMode !== 'live';

  async function move(nextAngle: number) {
    if (disabled || sending.current) return;
    const target = clampCameraAngle(nextAngle);
    sending.current = true;
    setBusy(true);
    setError('');
    setAngle(target);
    try {
      await setCameraAngle(target);
      setSentAngle(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Camera command failed');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label="Camera position" className="pointer-events-auto rounded-md border border-accent-data/40 bg-surface-primary/90 p-2 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-accent-data"><Camera className="h-3.5 w-3.5" />Camera</span>
        <output aria-live="polite" className="text-text-primary">Target {angle > 0 ? '+' : ''}{angle}°</output>
      </div>
      <input
        aria-label="Camera angle"
        aria-valuetext={`${angle} degrees${angle < 0 ? ', forward' : angle > 0 ? ', backward' : ''}`}
        type="range" min={CAMERA_MIN_DEG} max={CAMERA_MAX_DEG} step={1} value={angle}
        disabled={disabled}
        onChange={event => setAngle(event.currentTarget.valueAsNumber)}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerUp={event => void move(event.currentTarget.valueAsNumber)}
        onPointerCancel={() => setAngle(sentAngle ?? 0)}
        onKeyUp={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
            void move(event.currentTarget.valueAsNumber);
          }
        }}
        className="block h-11 w-full cursor-pointer touch-none accent-accent-data disabled:opacity-40"
      />
      <div className="grid grid-cols-[1fr_2.75rem_1fr] gap-1">
        <button type="button" className={buttonClass} disabled={disabled || angle <= CAMERA_MIN_DEG} onClick={() => void move(angle - 5)} aria-label="Look forward 5 degrees">− Forward</button>
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => void move(0)} aria-label="Camera zero">0°</button>
        <button type="button" className={buttonClass} disabled={disabled || angle >= CAMERA_MAX_DEG} onClick={() => void move(angle + 5)} aria-label="Look backward 5 degrees">Backward +</button>
      </div>
      <div role="status" className="mt-1 truncate font-mono text-[9px] text-text-muted" title={error || undefined}>
        {error || (connection.status !== 'connected' ? 'Offline' : busy ? 'Sending…' : sentAngle === null ? 'Release slider to move · Hold mode' : `Sent ${sentAngle}° · Hold mode`)}
      </div>
    </section>
  );
}
