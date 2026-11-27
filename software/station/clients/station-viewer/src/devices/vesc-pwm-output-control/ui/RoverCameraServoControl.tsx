import { useEffect, useId, useRef, useState } from 'react';
import { CAMERA_MAX_DEG, CAMERA_MIN_DEG, CAMERA_STEP_DEG, CAMERA_STEP_DELAY_MS, clampCameraAngle, getLastCameraAngle, getLastCameraCommandAt, getPendingCameraCommand, setCameraAngle } from '../camera-servo';
interface RoverCameraServoControlProps {
  expanded: boolean;
  onToggle: () => void;
  disabled: boolean;
}
export default function RoverCameraServoControl({ expanded, onToggle, disabled }: RoverCameraServoControlProps) {
  const id = useId();
  const [angle, setAngle] = useState(getLastCameraAngle);
  const [sentAngle, setSentAngle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const pending = useRef<number | null>(null);
  const lastSent = useRef(getLastCameraAngle());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const enabled = useRef(!disabled);
  function cancelPending() {
    pending.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelPending(); };
  }, []);
  useEffect(() => {
    enabled.current = !disabled;
    if (disabled) { cancelPending(); setBusy(false); setAngle(lastSent.current); }
  }, [disabled]);
  async function flush() {
    if (sending.current || timer.current !== null || !mounted.current || !enabled.current || pending.current === null) return;
    const previousCommand = getPendingCameraCommand();
    if (previousCommand) {
      // A prior cockpit can unmount while its command is still in flight.
      sending.current = true; setBusy(true);
      try {
        await previousCommand;
      } catch (cause) {
        cancelPending();
        if (mounted.current) { setError(cause instanceof Error ? cause.message : 'Camera command failed'); setBusy(false); }
      } finally {
        sending.current = false;
      }
      void flush();
      return;
    }
    lastSent.current = getLastCameraAngle();
    const wait = CAMERA_STEP_DELAY_MS - (Date.now() - getLastCameraCommandAt());
    if (wait > 0) {
      timer.current = setTimeout(() => { timer.current = null; void flush(); }, wait);
      return;
    }
    const remaining = pending.current - lastSent.current;
    if (remaining === 0) { pending.current = null; setBusy(false); return; }
    const target = lastSent.current + Math.sign(remaining) * CAMERA_STEP_DEG;
    sending.current = true; setBusy(true);
    try {
      // Coalesce targets, never intermediate steps. Wait after acknowledgement
      // so a slow connection cannot release a burst of queued motion commands.
      await setCameraAngle(target);
      lastSent.current = target;
      if (mounted.current) {
        setSentAngle(target); setError('');
        if (!enabled.current) setAngle(target);
        if (pending.current === target) { pending.current = null; setBusy(false); }
        if (enabled.current) timer.current = setTimeout(() => {
          timer.current = null;
          void flush();
        }, CAMERA_STEP_DELAY_MS);
      }
    } catch (cause) {
      cancelPending();
      if (mounted.current) { setError(cause instanceof Error ? cause.message : 'Camera command failed'); setBusy(false); setAngle(lastSent.current); }
    } finally {
      sending.current = false;
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
      <input aria-label="Camera angle" aria-valuetext={`${angle} degrees target`} type="range" min={CAMERA_MIN_DEG} max={CAMERA_MAX_DEG} step={CAMERA_STEP_DEG}
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
