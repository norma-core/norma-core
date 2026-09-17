import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPwmOutputSteeringAngle, PWM_OUTPUT_DEFAULT_CHANNEL, PWM_OUTPUT_STEERING_CENTER_DEG } from '@/devices/pwm-output/commands';
import { setVescTrampaRpm } from '@/devices/vesc-trampa/commands';
import { ROVER_DEFAULT_RPM_LIMIT, ROVER_MAX_RPM_LIMIT, ROVER_MIN_DRIVE_RPM, mapRoverControlInput, normalizeSquareJoystickInput } from './control-input';

const IDLE = { rpm: 0, steeringDeg: PWM_OUTPUT_STEERING_CENTER_DEG };
const ZERO_AXES = { x: 0, y: 0 };
const COMMAND_DURATION_MS = 250;
const SEND_INTERVAL_MS = 50;

interface UseRoverControlSessionOptions {
  boardUuid: Uint8Array;
  steeringOutputId: string;
  suspended?: boolean;
}

export function useRoverControlSession({ boardUuid, steeringOutputId, suspended = false }: UseRoverControlSessionOptions) {
  const [axes, setAxes] = useState(ZERO_AXES);
  const [rpmLimit, setRpmLimitState] = useState(ROVER_DEFAULT_RPM_LIMIT);
  const [error, setError] = useState<string | null>(null);
  const [touchActive, setTouchActive] = useState(false);
  const limitRef = useRef(rpmLimit);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const keys = useRef(new Set<string>());
  const inputRef = useRef(ZERO_AXES);
  const touchRef = useRef(false);
  const controlsRef = useRef<{ send: (input: typeof ZERO_AXES) => void; stop: () => void } | null>(null);
  const uuidKey = Array.from(boardUuid).join(',');

  // Each session captures its destination. A target change/unmount stops the OLD
  // destination, even if another command is still awaiting acknowledgement.
  useEffect(() => {
    const uuid = new Uint8Array(uuidKey ? uuidKey.split(',').map(Number) : []);
    let pending: typeof IDLE | null = null;
    let sending = false;
    let disposed = false;
    let issued = false;
    let interval: number | null = null;
    const clearLoop = () => { if (interval !== null) window.clearInterval(interval); interval = null; };
    async function flush() {
      if (sending) return;
      sending = true;
      try {
        while (pending) {
          const target = pending;
          pending = null;
          try {
            // Preserve command ordering; later input occupies only the pending slot.
            // eslint-disable-next-line no-await-in-loop
            await Promise.all([
              uuid.length ? setVescTrampaRpm(uuid, target.rpm, COMMAND_DURATION_MS) : Promise.resolve(),
              steeringOutputId ? setPwmOutputSteeringAngle(steeringOutputId, PWM_OUTPUT_DEFAULT_CHANNEL,
                target.steeringDeg, 20_000, Math.ceil(COMMAND_DURATION_MS / 20)) : Promise.resolve(),
            ]);
          } catch {
            if (!disposed) setError('Control command failed');
            // End retries until a new deliberate input. Firmware's finite lease
            // still expires if this final zero cannot reach the rover.
            clearLoop();
            if (target.rpm !== 0 || target.steeringDeg !== IDLE.steeringDeg) pending = IDLE;
            if (!disposed) {
              inputRef.current = ZERO_AXES; keys.current.clear(); touchRef.current = false;
              setAxes(ZERO_AXES); setTouchActive(false);
            }
          }
        }
      } finally { sending = false; }
    }
    const enqueue = (target: typeof IDLE) => { pending = target; issued = true; void flush(); };
    const stop = () => {
      clearLoop();
      if (issued) enqueue(IDLE);
    };
    controlsRef.current = {
      send(input) {
        if (disposed || suspendedRef.current) return;
        const sendLatest = () => enqueue(mapRoverControlInput(inputRef.current.x, inputRef.current.y, limitRef.current));
        inputRef.current = input;
        sendLatest();
        if (input.x || input.y) { if (interval === null) interval = window.setInterval(sendLatest, SEND_INTERVAL_MS); }
        else clearLoop();
      }, stop,
    };
    keys.current.clear(); inputRef.current = ZERO_AXES; touchRef.current = false;
    setAxes(ZERO_AXES); setTouchActive(false);
    return () => { disposed = true; stop(); controlsRef.current = null; };
  }, [uuidKey, steeringOutputId]);

  const stop = useCallback(() => {
    keys.current.clear(); inputRef.current = ZERO_AXES; touchRef.current = false;
    setAxes(ZERO_AXES); setTouchActive(false); controlsRef.current?.stop();
  }, []);
  const apply = useCallback((x: number, y: number) => {
    if (suspendedRef.current) return;
    const input = normalizeSquareJoystickInput(x, y, .12);
    setAxes(input); controlsRef.current?.send(input);
  }, []);
  useEffect(() => { if (suspended) stop(); }, [suspended, stop]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState !== 'visible') stop(); };
    const navigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) stop();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { stop(); return; }
      if (suspendedRef.current || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const el = event.target as HTMLElement | null;
      if (el?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el?.tagName ?? '')) return;
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
      event.preventDefault();
      if (touchRef.current || keys.current.has(event.code)) return;
      keys.current.add(event.code);
      apply(Number(keys.current.has('KeyD')) - Number(keys.current.has('KeyA')),
        Number(keys.current.has('KeyS')) - Number(keys.current.has('KeyW')));
    };
    const keyup = (event: KeyboardEvent) => {
      if (!keys.current.delete(event.code)) return;
      event.preventDefault();
      apply(Number(keys.current.has('KeyD')) - Number(keys.current.has('KeyA')),
        Number(keys.current.has('KeyS')) - Number(keys.current.has('KeyW')));
    };
    // Link intent precedes lazy route loading; unmount may be delayed by React.
    document.addEventListener('click', navigation, true);
    window.addEventListener('popstate', stop);
    window.addEventListener('hashchange', stop);
    window.addEventListener('blur', stop); window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => {
      document.removeEventListener('click', navigation, true);
      window.removeEventListener('popstate', stop);
      window.removeEventListener('hashchange', stop);
      window.removeEventListener('blur', stop); window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
    };
  }, [apply, stop]);
  const actions = useMemo(() => ({
    stop,
    startTouch: () => { if (!suspendedRef.current) { keys.current.clear(); touchRef.current = true; setTouchActive(true); setError(null); } },
    setTouchInput: (x: number, y: number) => { if (touchRef.current) apply(x, y); },
    releaseTouch: () => { if (touchRef.current) stop(); },
    setRpmLimit: (value: number) => {
      if (!Number.isFinite(value)) return;
      stop();
      const limit = Math.round(Math.max(ROVER_MIN_DRIVE_RPM, Math.min(ROVER_MAX_RPM_LIMIT, value)) / 50) * 50;
      limitRef.current = limit; setRpmLimitState(limit);
    },
  }), [apply, stop]);
  const target = mapRoverControlInput(axes.x, axes.y, rpmLimit);
  return { state: { axes, ...target, rpmLimit, touchActive, error,
    active: Boolean(axes.x || axes.y), disabled: suspended || !boardUuid.length || !steeringOutputId }, actions };
}
export type RoverControlSession = ReturnType<typeof useRoverControlSession>;
