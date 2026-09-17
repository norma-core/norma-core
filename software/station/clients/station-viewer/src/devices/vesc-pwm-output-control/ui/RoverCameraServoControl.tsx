import { useEffect, useId, useRef, useState } from 'react';
import { CAMERA_MAX_DEG, CAMERA_MIN_DEG, clampCameraAngle, setCameraAngle } from '../camera-servo';
interface RoverCameraServoControlProps {
  expanded: boolean;
  onToggle: () => void;
  disabled: boolean;
}
export default function RoverCameraServoControl({ expanded, onToggle, disabled }: RoverCameraServoControlProps) {
  const id = useId();
  const [angle, setAngle] = useState(0);
  const [sentAngle, setSentAngle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const pending = useRef<number | null>(null);
  const lastSent = useRef<number | null>(null);
  const mounted = useRef(false);
  const enabled = useRef(!disabled);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);
  useEffect(() => {
    enabled.current = !disabled;
    if (disabled) pending.current = null;
  }, [disabled]);
  async function flush() {
    if (sending.current) return;
    sending.current = true; setBusy(true);
    try {
      // One write in flight, one replaceable target. A slow connection must not
      // replay obsolete angles after the user has finished dragging.
      while (mounted.current && enabled.current && pending.current !== null) {
        const target = pending.current;
        pending.current = null;
        if (target === lastSent.current) continue;
        try {
          // eslint-disable-next-line no-await-in-loop -- servo writes must stay ordered with only the latest target pending
          await setCameraAngle(target);
          if (mounted.current) {
            lastSent.current = target; setSentAngle(target); setError('');
          }
        } catch (cause) {
          if (mounted.current) setError(cause instanceof Error ? cause.message : 'Camera command failed');
        }
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function move(value: number) {
    if (disabled) return;
    const target = clampCameraAngle(value);
    setAngle(target); setError('');
    pending.current = target;
    void flush();
  }
  const displayAngle = `${angle > 0 ? '+' : ''}${angle}°`;
  return <section className={`rover-camera rover-panel ${expanded ? 'expanded' : ''}`} aria-label="Camera travel">
    <button type="button" className="rover-setting-toggle" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
      <span>Camera</span><output>{sentAngle === null && !busy ? '—' : displayAngle}</output><span aria-hidden>⌄</span>
    </button>
    <div id={id} className="rover-setting-content">
      <div className="rover-panel-heading"><span>Camera</span><output>{displayAngle}</output></div>
      <div className="rover-angle-line"><span>Under wheels</span><span>Rear</span></div>
      <input aria-label="Camera angle" aria-valuetext={`${angle} degrees target`} type="range" min={CAMERA_MIN_DEG} max={CAMERA_MAX_DEG} step={1}
        value={angle} disabled={disabled}
        onChange={event => move(event.currentTarget.valueAsNumber)}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} />
      <div className="rover-camera-presets">
        <button type="button" disabled={disabled} onClick={() => void move(CAMERA_MIN_DEG)}>Under wheels</button>
        <button type="button" disabled={disabled} onClick={() => void move(0)}>Reference</button>
        <button type="button" disabled={disabled} onClick={() => void move(CAMERA_MAX_DEG)}>Rear</button>
      </div>
      {(error || busy) && <div className="rover-error" role="status">{error || 'Sending…'}</div>}
    </div>
  </section>;
}
