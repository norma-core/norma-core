import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent
} from 'react';
import { commandManager } from '@/api/commands.js';

interface DogzillaDesktopMovementPanelProps {
  deviceSerial: string;
}

const NEUTRAL = 128;
const THROTTLE_MS = 50;
const PAD_RADIUS = 48;
const KNOB_RADIUS = 16;
const KNOB_TRAVEL = PAD_RADIUS - KNOB_RADIUS;

const clampNormalized = (value: number) => Math.max(-1, Math.min(1, value));
const normalizedToByte = (value: number) => Math.max(0, Math.min(255, Math.round(NEUTRAL + value * 127)));

const DogzillaDesktopMovementPanel = memo(function DogzillaDesktopMovementPanel({
  deviceSerial
}: DogzillaDesktopMovementPanelProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<{ moveX: number; moveY: number; moveYaw: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const joystickRef = useRef({ x: 0, y: 0 });
  const yawRef = useRef(NEUTRAL);
  const draggingRef = useRef(false);

  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [yaw, setYaw] = useState(NEUTRAL);
  const [isDragging, setIsDragging] = useState(false);

  const sendMovementCommand = useCallback(
    (values: { moveX: number; moveY: number; moveYaw: number }) => {
      commandManager.sendDogzillaCommand({
        targetDeviceSerial: deviceSerial,
        movement: {
          moveX: values.moveX,
          moveY: values.moveY,
          moveYaw: values.moveYaw
        }
      });
    },
    [deviceSerial]
  );

  const flushPending = useCallback(() => {
    if (pendingRef.current) {
      sendMovementCommand(pendingRef.current);
      pendingRef.current = null;
      lastSentRef.current = performance.now();
    }
    timerRef.current = null;
  }, [sendMovementCommand]);

  const scheduleSend = useCallback(
    (values: { moveX: number; moveY: number; moveYaw: number }) => {
      const now = performance.now();
      const elapsed = now - lastSentRef.current;
      if (elapsed >= THROTTLE_MS && timerRef.current === null) {
        sendMovementCommand(values);
        lastSentRef.current = now;
        return;
      }
      pendingRef.current = values;
      if (timerRef.current === null) {
        const wait = Math.max(0, THROTTLE_MS - elapsed);
        timerRef.current = window.setTimeout(flushPending, wait);
      }
    },
    [flushPending, sendMovementCommand]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const movementValues = useMemo(() => {
    const moveX = normalizedToByte(-joystick.y);
    const moveY = normalizedToByte(-joystick.x);
    return { moveX, moveY, moveYaw: yaw };
  }, [joystick, yaw]);

  const updateJoystick = useCallback(
    (next: { x: number; y: number }) => {
      joystickRef.current = next;
      setJoystick(next);
      scheduleSend({
        moveX: normalizedToByte(-next.y),
        moveY: normalizedToByte(-next.x),
        moveYaw: yawRef.current
      });
    },
    [scheduleSend]
  );

  const updateYaw = useCallback(
    (nextYaw: number) => {
      yawRef.current = nextYaw;
      setYaw(nextYaw);
      scheduleSend({
        moveX: normalizedToByte(-joystickRef.current.y),
        moveY: normalizedToByte(-joystickRef.current.x),
        moveYaw: nextYaw
      });
    },
    [scheduleSend]
  );

  const stopTranslation = useCallback(() => {
    const next = { x: 0, y: 0 };
    joystickRef.current = next;
    setJoystick(next);
    scheduleSend({
      moveX: NEUTRAL,
      moveY: NEUTRAL,
      moveYaw: yawRef.current
    });
  }, [scheduleSend]);

  const stopYaw = useCallback(() => {
    yawRef.current = NEUTRAL;
    setYaw(NEUTRAL);
    scheduleSend({
      moveX: normalizedToByte(-joystickRef.current.y),
      moveY: normalizedToByte(-joystickRef.current.x),
      moveYaw: NEUTRAL
    });
  }, [scheduleSend]);

  const stopAll = useCallback(() => {
    joystickRef.current = { x: 0, y: 0 };
    yawRef.current = NEUTRAL;
    setJoystick({ x: 0, y: 0 });
    setYaw(NEUTRAL);
    scheduleSend({
      moveX: NEUTRAL,
      moveY: NEUTRAL,
      moveYaw: NEUTRAL
    });
  }, [scheduleSend]);

  const updateFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const pad = padRef.current;
      if (!pad) {
        return;
      }
      const rect = pad.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const radius = rect.width / 2;
      let x = clampNormalized(dx / radius);
      let y = clampNormalized(dy / radius);
      const magnitude = Math.hypot(x, y);
      if (magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }
      updateJoystick({ x, y });
    },
    [updateJoystick]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    },
    [updateFromPointer]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      updateFromPointer(event);
    },
    [updateFromPointer]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      setIsDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      stopTranslation();
    },
    [stopTranslation]
  );

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        stopAll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [stopAll]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/90 p-2 backdrop-blur">
      <h3 className="border-b border-gray-700 pb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
        Movement
      </h3>
      <div className="mt-2 flex flex-col items-center gap-2 text-[10px] text-gray-300">
        <div
          ref={padRef}
          role="presentation"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative h-24 w-24 touch-none rounded-full border border-gray-600 bg-gray-800/70"
        >
          <div
            className="absolute left-1/2 top-1/2 h-8 w-8 rounded-full border border-cyan-400/70 bg-cyan-500/60"
            style={{
              transform: `translate(-50%, -50%) translate(${joystick.x * KNOB_TRAVEL}px, ${joystick.y * KNOB_TRAVEL}px)`
            }}
          />
          <div className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-gray-400" />
        </div>
        <div className="flex w-full items-center justify-between text-[9px] text-gray-400">
          <span>X {movementValues.moveX}</span>
          <span>Y {movementValues.moveY}</span>
          <span>Yaw {movementValues.moveYaw}</span>
        </div>
        <div className="w-full">
          <div className="flex items-center justify-between text-[9px] text-gray-400">
            <span>Rotate</span>
            <span className="font-mono text-cyan-200">{yaw}</span>
          </div>
          <input
            type="range"
            min={0}
            max={255}
            value={yaw}
            onChange={(event) => updateYaw(Number(event.target.value))}
            onMouseUp={stopYaw}
            onTouchEnd={stopYaw}
            className="h-1 w-full accent-cyan-400"
          />
        </div>
        <button
          type="button"
          onClick={stopAll}
          className="w-full rounded border border-red-500/60 bg-red-500/20 py-1 text-[9px] font-semibold uppercase tracking-wide text-red-200 transition hover:border-red-300 hover:text-red-100"
        >
          Stop
        </button>
        <div className={`text-[9px] ${isDragging ? 'text-cyan-300' : 'text-gray-500'}`}>
          {isDragging ? 'Dragging' : 'Idle'}
        </div>
      </div>
    </div>
  );
});

export default DogzillaDesktopMovementPanel;
