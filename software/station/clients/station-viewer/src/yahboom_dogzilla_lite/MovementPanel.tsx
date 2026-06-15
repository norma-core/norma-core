import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent
} from 'react';
import { commandManager } from '@/api/commands.js';

interface MovementPanelProps {
  deviceSerial: string;
  legsSpeed: number;
  armSpeed: number;
  onLegsSpeedChange: (value: number) => void;
  onLegsSpeedCommit: () => void;
  onArmSpeedChange: (value: number) => void;
  onArmSpeedCommit: () => void;
}

export interface MovementPanelRef {
  stopAll: () => void;
}

const NEUTRAL = 128;
const THROTTLE_MS = 50;
const PAD_SIZE = 188;
const KNOB_SIZE = 58;
const KNOB_TRAVEL = 52;

const clampNormalized = (value: number) => Math.max(-1, Math.min(1, value));
const normalizedToByte = (value: number) => Math.max(0, Math.min(255, Math.round(NEUTRAL + value * 127)));

const MovementPanelComponent = forwardRef<MovementPanelRef, MovementPanelProps>(function MovementPanel(
  {
    deviceSerial,
    legsSpeed,
    armSpeed,
    onLegsSpeedChange,
    onLegsSpeedCommit,
    onArmSpeedChange,
    onArmSpeedCommit
  }: MovementPanelProps,
  ref
) {
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
      commandManager.sendYahboomDogzillaLiteCommand({
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

  const stopAll = useCallback(() => {
    draggingRef.current = false;
    joystickRef.current = { x: 0, y: 0 };
    yawRef.current = NEUTRAL;
    setJoystick({ x: 0, y: 0 });
    setYaw(NEUTRAL);
    setIsDragging(false);
    scheduleSend({
      moveX: NEUTRAL,
      moveY: NEUTRAL,
      moveYaw: NEUTRAL
    });
  }, [scheduleSend]);

  useImperativeHandle(
    ref,
    () => ({
      stopAll
    }),
    [stopAll]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

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

  const liveValues = useMemo(() => {
    return {
      forward: Math.round(-joystick.y * 100),
      strafe: Math.round(-joystick.x * 100),
      yaw: Math.round(((yaw - NEUTRAL) / 127) * 100)
    };
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
    joystickRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
    setIsDragging(false);
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
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopTranslation();
    },
    [stopTranslation]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wide text-text-label">
          <span>Movement</span>
          <span className={`${isDragging ? 'text-accent-data' : 'text-text-muted'} font-mono`}>{isDragging ? 'LIVE' : 'IDLE'}</span>
        </div>
        <div className="flex justify-center">
          <div
            ref={padRef}
            role="presentation"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative touch-none rounded-full border border-border-default bg-surface-base"
            style={{ width: PAD_SIZE, height: PAD_SIZE }}
          >
            <div className="absolute inset-[18%] rounded-full border border-border-subtle" />
            <div className="absolute inset-[34%] rounded-full border border-border-subtle" />
            <div className="absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-border-default" />
            <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-border-default" />
            <div
              className="absolute left-1/2 top-1/2 rounded-full border border-accent-data/70 bg-accent-data/10"
              style={{
                width: KNOB_SIZE,
                height: KNOB_SIZE,
                transform: `translate(-50%, -50%) translate(${joystick.x * KNOB_TRAVEL}px, ${joystick.y * KNOB_TRAVEL}px)`
              }}
            />
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-data bg-accent-data" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Fwd</div>
            <div className="mt-1 font-mono text-sm font-semibold text-accent-data">{liveValues.forward}%</div>
          </div>
          <div className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Strafe</div>
            <div className="mt-1 font-mono text-sm font-semibold text-accent-data">{liveValues.strafe}%</div>
          </div>
          <button
            type="button"
            onClick={stopAll}
            className="rounded-md border border-accent-critical-deep bg-accent-critical/10 px-3 py-2 text-center transition hover:border-accent-critical hover:bg-accent-critical/20"
          >
            <div className="text-[10px] uppercase tracking-wide text-accent-critical">Brake</div>
            <div className="mt-1 text-sm font-semibold text-accent-critical">Stop</div>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-text-label">
          <span>Yaw</span>
          <span className="font-mono text-accent-data">{liveValues.yaw}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={255}
          value={yaw}
          onChange={(event) => updateYaw(Number(event.target.value))}
          onMouseUp={stopYaw}
          onTouchEnd={stopYaw}
          className="control-slider mt-4 h-4 w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-3">
          <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wide text-text-label">
            <span>Leg Speed</span>
            <span className="font-mono text-accent-data">{legsSpeed}</span>
          </div>
          <input
            type="range"
            min={0}
            max={255}
            value={legsSpeed}
            onChange={(event) => onLegsSpeedChange(Number(event.target.value))}
            onMouseUp={onLegsSpeedCommit}
            onTouchEnd={onLegsSpeedCommit}
            className="control-slider mt-4 h-4 w-full"
          />
        </div>
        <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-3">
          <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wide text-text-label">
            <span>Arm Speed</span>
            <span className="font-mono text-accent-data">{armSpeed}</span>
          </div>
          <input
            type="range"
            min={0}
            max={255}
            value={armSpeed}
            onChange={(event) => onArmSpeedChange(Number(event.target.value))}
            onMouseUp={onArmSpeedCommit}
            onTouchEnd={onArmSpeedCommit}
            className="control-slider mt-4 h-4 w-full"
          />
        </div>
      </div>
    </div>
  );
});

const MovementPanel = memo(MovementPanelComponent);

export default MovementPanel;
