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
import { CONTROL_SLIDER_CLASS_NAME } from '@/yahboom_dogzilla_lite/control-classes';
import HeadingTape from '@/yahboom_dogzilla_lite/HeadingTape';

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
const KNOB_TRAVEL = 52;
const TOUCH_SELECT_GUARD_CLASS_NAME = 'select-none [-webkit-touch-callout:none] [-webkit-user-select:none]';

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
  const yawPadRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<{ moveX: number; moveY: number; moveYaw: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const joystickRef = useRef({ x: 0, y: 0 });
  const yawRef = useRef(NEUTRAL);
  const draggingRef = useRef(false);
  const yawDraggingRef = useRef(false);

  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [yaw, setYaw] = useState(NEUTRAL);
  const [isDragging, setIsDragging] = useState(false);
  const [isYawDragging, setIsYawDragging] = useState(false);

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
    setIsYawDragging(false);
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

  const updateYawFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const pad = yawPadRef.current;
      if (!pad) {
        return;
      }

      const rect = pad.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const x = clampNormalized((event.clientX - centerX) / (rect.width / 2));
      updateYaw(normalizedToByte(x));
    },
    [updateYaw]
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

  const handleYawPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      yawDraggingRef.current = true;
      setIsYawDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateYawFromPointer(event);
    },
    [updateYawFromPointer]
  );

  const handleYawPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!yawDraggingRef.current) {
        return;
      }
      updateYawFromPointer(event);
    },
    [updateYawFromPointer]
  );

  const handleYawPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!yawDraggingRef.current) {
        return;
      }
      yawDraggingRef.current = false;
      setIsYawDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopYaw();
    },
    [stopYaw]
  );

  const handleHeadingTapeStart = useCallback(() => {
    yawDraggingRef.current = true;
    setIsYawDragging(true);
  }, []);

  const handleHeadingTapeEnd = useCallback(() => {
    yawDraggingRef.current = false;
    setIsYawDragging(false);
    stopYaw();
  }, [stopYaw]);

  const yawNormalized = clampNormalized((yaw - NEUTRAL) / 127);

  return (
    <div className="space-y-4 group-data-[remote-fullscreen=true]/dashboard:grid group-data-[remote-fullscreen=true]/dashboard:h-full group-data-[remote-fullscreen=true]/dashboard:!grid-cols-[minmax(13rem,20vw)_minmax(0,1fr)_minmax(16rem,24vw)] group-data-[remote-fullscreen=true]/dashboard:grid-rows-[1fr] group-data-[remote-fullscreen=true]/dashboard:items-end group-data-[remote-fullscreen=true]/dashboard:!gap-8 group-data-[remote-fullscreen=true]/dashboard:!px-8 group-data-[remote-fullscreen=true]/dashboard:!pb-[6.15rem] group-data-[remote-fullscreen=true]/dashboard:!pt-[6rem] group-data-[remote-fullscreen=true]/dashboard:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:grid [@media(max-width:1023px)_and_(orientation:landscape)]:h-full [@media(max-width:1023px)_and_(orientation:landscape)]:grid-cols-[minmax(10rem,22vw)_minmax(0,1fr)_minmax(10rem,22vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:grid-rows-[1fr] [@media(max-width:1023px)_and_(orientation:landscape)]:items-end [@media(max-width:1023px)_and_(orientation:landscape)]:gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:px-4 [@media(max-width:1023px)_and_(orientation:landscape)]:pb-[4.85rem] [@media(max-width:1023px)_and_(orientation:landscape)]:pt-[3.6rem] [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:pb-[4.35rem] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:pt-[3.3rem] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!block [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!h-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!space-y-3 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!px-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pb-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pt-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pointer-events-auto">
      <HeadingTape
        yawValue={yaw}
        isActive={isYawDragging}
        onChange={updateYaw}
        onPointerStart={handleHeadingTapeStart}
        onPointerEnd={handleHeadingTapeEnd}
      />

      <div className={`${TOUCH_SELECT_GUARD_CLASS_NAME} rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4 group-data-[remote-fullscreen=true]/dashboard:relative group-data-[remote-fullscreen=true]/dashboard:col-start-1 group-data-[remote-fullscreen=true]/dashboard:row-start-1 group-data-[remote-fullscreen=true]/dashboard:self-end group-data-[remote-fullscreen=true]/dashboard:!w-[min(14rem,20vw)] group-data-[remote-fullscreen=true]/dashboard:rounded-lg group-data-[remote-fullscreen=true]/dashboard:border-accent-data/30 group-data-[remote-fullscreen=true]/dashboard:bg-surface-primary/45 group-data-[remote-fullscreen=true]/dashboard:!p-3 group-data-[remote-fullscreen=true]/dashboard:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-md group-data-[remote-fullscreen=true]/dashboard:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:relative [@media(max-width:1023px)_and_(orientation:landscape)]:col-start-1 [@media(max-width:1023px)_and_(orientation:landscape)]:row-start-1 [@media(max-width:1023px)_and_(orientation:landscape)]:self-end [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(12.5rem,23vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/45 [@media(max-width:1023px)_and_(orientation:landscape)]:p-[0.55rem] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:w-[min(11rem,22vw)] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:p-2.5 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!w-full [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!max-w-none [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!bg-surface-primary/80 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!p-3`}>
        <div className="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-text-label [@media(max-width:1023px)_and_(orientation:landscape)]:mb-1 [@media(max-width:1023px)_and_(orientation:landscape)]:px-1 [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.58rem] [@media(max-width:1023px)_and_(orientation:landscape)]:tracking-[0.12em]">
          <span className="min-w-0 truncate whitespace-nowrap [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">Movement</span>
          <span className="hidden whitespace-nowrap [@media(max-width:1023px)_and_(orientation:landscape)]:inline">Move</span>
          <span className={`shrink-0 whitespace-nowrap font-mono [@media(max-width:1023px)_and_(orientation:landscape)]:hidden ${isDragging ? 'text-accent-data' : 'text-text-muted'}`}>
            {isDragging ? '[ LIVE ]' : '[ IDLE ]'}
          </span>
          <span className={`hidden shrink-0 whitespace-nowrap font-mono [@media(max-width:1023px)_and_(orientation:landscape)]:inline ${isDragging ? 'text-accent-data' : 'text-text-muted'}`}>
            {isDragging ? 'Live' : 'Idle'}
          </span>
        </div>
        <div className="flex justify-center">
          <div
            ref={padRef}
            role="presentation"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`${TOUCH_SELECT_GUARD_CLASS_NAME} relative h-[188px] w-[188px] touch-none rounded-full border border-border-default bg-surface-base group-data-[remote-fullscreen=true]/dashboard:mx-auto group-data-[remote-fullscreen=true]/dashboard:!h-[min(22vmin,11rem)] group-data-[remote-fullscreen=true]/dashboard:!w-[min(22vmin,11rem)] group-data-[remote-fullscreen=true]/dashboard:bg-surface-base/30 group-data-[remote-fullscreen=true]/dashboard:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45),inset_0_0_4rem_rgba(34,211,238,0.08)] [@media(max-width:1023px)_and_(orientation:landscape)]:mx-auto [@media(max-width:1023px)_and_(orientation:landscape)]:h-[min(27vmin,10.5rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(27vmin,10.5rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-base/30 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45),inset_0_0_4rem_rgba(34,211,238,0.08)] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[min(24vmin,9rem)] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:w-[min(24vmin,9rem)] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!h-[9.5rem] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!w-[9.5rem]`}
          >
            <span className="pointer-events-none absolute -left-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-l-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute -right-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-r-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute -bottom-1 -left-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-l-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute -bottom-1 -right-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-r-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <div className="absolute inset-[18%] rounded-full border border-border-subtle" />
            <div className="absolute inset-[34%] rounded-full border border-border-subtle" />
            <div className="absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-border-default" />
            <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-border-default" />
            <div
              className="absolute left-1/2 top-1/2 h-[58px] w-[58px] rounded-full border border-accent-data/70 bg-accent-data/10 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0_0.6rem_rgba(34,211,238,0.50)]"
              style={{
                transform: `translate(-50%, -50%) translate(${joystick.x * KNOB_TRAVEL}px, ${joystick.y * KNOB_TRAVEL}px)`
              }}
            />
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-data bg-accent-data" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
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

      <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-3 [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-text-label">
          <span>Yaw</span>
          <span className={`font-mono ${isYawDragging ? 'text-accent-data' : 'text-text-muted'}`}>
            {isYawDragging ? `[ ${liveValues.yaw}% ]` : '[ READY ]'}
          </span>
        </div>
        <div
          ref={yawPadRef}
          role="slider"
          aria-label="Yaw"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={liveValues.yaw}
          tabIndex={0}
          onPointerDown={handleYawPointerDown}
          onPointerMove={handleYawPointerMove}
          onPointerUp={handleYawPointerUp}
          onPointerCancel={handleYawPointerUp}
          className="relative hidden touch-none select-none"
        >
          <div className="absolute inset-0 rounded-full" />
          <div>‹</div>
          <div>›</div>
          <div
            className=""
            style={{ transform: `translate(-50%, -50%) rotate(${yawNormalized * 82}deg)` }}
          />
          <div>
            <span>{liveValues.yaw}</span>
            <span>YAW</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={255}
          value={yaw}
          onChange={(event) => updateYaw(Number(event.target.value))}
          onMouseUp={stopYaw}
          onTouchEnd={stopYaw}
          className={CONTROL_SLIDER_CLASS_NAME}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
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
            className={CONTROL_SLIDER_CLASS_NAME}
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
            className={CONTROL_SLIDER_CLASS_NAME}
          />
        </div>
      </div>
    </div>
  );
});

const MovementPanel = memo(MovementPanelComponent);

export default MovementPanel;
