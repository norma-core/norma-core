import { memo, useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { commandManager } from '@/api/commands.js';
import { yahboom_dogzilla_lite } from '@/api/proto.js';

interface YahboomDogzillaLiteDesktopMovementPanelProps {
  deviceSerial: string;
  reverseOrder?: boolean;
  showHints?: boolean;
}

interface KeyboardState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  rotateLeftKey: boolean;
  rotateLeftArrow: boolean;
  rotateRightKey: boolean;
  rotateRightArrow: boolean;
}

const NEUTRAL = 128;
const THROTTLE_MS = 50;
const PAD_RADIUS = 48;
const MOVE_KNOB_SIZE = 40;
const KNOB_TRAVEL = PAD_RADIUS - MOVE_KNOB_SIZE / 2 - 4;
const ROTATION_SOCKET_WIDTH = 112;
const ROTATION_KNOB_SIZE = 40;
const ROTATION_KNOB_TRAVEL = ROTATION_SOCKET_WIDTH / 2 - ROTATION_KNOB_SIZE / 2 - 4;

const PAD_SOCKET_CLASS = 'relative h-24 w-24 touch-none rounded-full border-2 border-border-default bg-surface-secondary shadow-inner';
const ROTATION_SOCKET_CLASS = 'relative h-12 w-28 touch-none rounded-full border-2 border-border-default bg-surface-secondary shadow-inner';
const STICK_KNOB_CLASS = 'absolute left-1/2 top-1/2 rounded-full border border-border-default bg-surface-elevated shadow-sm';

const clampNormalized = (value: number) => Math.max(-1, Math.min(1, value));
const normalizedToByte = (value: number) => Math.max(0, Math.min(255, Math.round(NEUTRAL + value * 127)));
const byteToNormalized = (value: number) => clampNormalized((value - NEUTRAL) / 127);
const createKeyboardState = (): KeyboardState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  rotateLeftKey: false,
  rotateLeftArrow: false,
  rotateRightKey: false,
  rotateRightArrow: false
});

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
};

const YahboomDogzillaLiteDesktopMovementPanel = memo(function YahboomDogzillaLiteDesktopMovementPanel({
  deviceSerial,
  reverseOrder = false,
  showHints = true
}: YahboomDogzillaLiteDesktopMovementPanelProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const rotationRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<{ moveX: number; moveY: number; moveYaw: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const joystickRef = useRef({ x: 0, y: 0 });
  const yawRef = useRef(NEUTRAL);
  const draggingRef = useRef(false);
  const rotatingRef = useRef(false);
  const keyboardStateRef = useRef<KeyboardState>(createKeyboardState());
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [yaw, setYaw] = useState(NEUTRAL);
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

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

  const sendSitAction = useCallback(() => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: deviceSerial,
      action: { action: yahboom_dogzilla_lite.ActionType.ACTION_SIT_DOWN }
    });
  }, [deviceSerial]);

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

  const setControls = useCallback(
    (nextJoystick: { x: number; y: number }, nextYaw: number) => {
      joystickRef.current = nextJoystick;
      yawRef.current = nextYaw;
      setJoystick(nextJoystick);
      setYaw(nextYaw);
      scheduleSend({
        moveX: normalizedToByte(-nextJoystick.y),
        moveY: normalizedToByte(-nextJoystick.x),
        moveYaw: nextYaw
      });
    },
    [scheduleSend]
  );

  const yawNormalized = byteToNormalized(yaw);

  const updateJoystick = useCallback(
    (next: { x: number; y: number }) => {
      setControls(next, yawRef.current);
    },
    [setControls]
  );

  const updateYaw = useCallback(
    (nextYaw: number) => {
      setControls(joystickRef.current, nextYaw);
    },
    [setControls]
  );

  const stopTranslation = useCallback(() => {
    setControls({ x: 0, y: 0 }, yawRef.current);
  }, [setControls]);

  const stopYaw = useCallback(() => {
    setControls(joystickRef.current, NEUTRAL);
  }, [setControls]);

  const stopAll = useCallback(() => {
    setControls({ x: 0, y: 0 }, NEUTRAL);
  }, [setControls]);

  const applyKeyboardState = useCallback(() => {
    const keyboard = keyboardStateRef.current;
    let x = (keyboard.right ? 1 : 0) - (keyboard.left ? 1 : 0);
    let y = (keyboard.backward ? 1 : 0) - (keyboard.forward ? 1 : 0);
    const magnitude = Math.hypot(x, y);

    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }

    const yawDirection = (
      keyboard.rotateLeftKey || keyboard.rotateLeftArrow ? 1 : 0
    ) - (
      keyboard.rotateRightKey || keyboard.rotateRightArrow ? 1 : 0
    );
    setControls({ x, y }, normalizedToByte(yawDirection));
  }, [setControls]);

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

  const updateRotationFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const ring = rotationRef.current;
      if (!ring) {
        return;
      }

      const rect = ring.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dx = event.clientX - centerX;
      const radius = rect.width / 2;
      const normalized = clampNormalized(-dx / radius);
      updateYaw(normalizedToByte(normalized));
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
      setIsDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      stopTranslation();
    },
    [stopTranslation]
  );

  const handleRotationPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      rotatingRef.current = true;
      setIsRotating(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateRotationFromPointer(event);
    },
    [updateRotationFromPointer]
  );

  const handleRotationPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!rotatingRef.current) {
        return;
      }
      updateRotationFromPointer(event);
    },
    [updateRotationFromPointer]
  );

  const handleRotationPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!rotatingRef.current) {
        return;
      }
      rotatingRef.current = false;
      setIsRotating(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      stopYaw();
    },
    [stopYaw]
  );

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        keyboardStateRef.current = createKeyboardState();
        stopAll();
      }
    };

    const handleBlur = () => {
      keyboardStateRef.current = createKeyboardState();
      stopAll();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }

      const keyboard = keyboardStateRef.current;
      let handled = true;
      let changed = false;

      switch (event.code) {
        case 'KeyW':
          changed = !keyboard.forward;
          keyboard.forward = true;
          break;
        case 'KeyS':
          changed = !keyboard.backward;
          keyboard.backward = true;
          break;
        case 'KeyA':
          changed = !keyboard.left;
          keyboard.left = true;
          break;
        case 'KeyD':
          changed = !keyboard.right;
          keyboard.right = true;
          break;
        case 'KeyQ':
          changed = !keyboard.rotateLeftKey;
          keyboard.rotateLeftKey = true;
          break;
        case 'ArrowLeft':
          changed = !keyboard.rotateLeftArrow;
          keyboard.rotateLeftArrow = true;
          break;
        case 'KeyE':
          changed = !keyboard.rotateRightKey;
          keyboard.rotateRightKey = true;
          break;
        case 'ArrowRight':
          changed = !keyboard.rotateRightArrow;
          keyboard.rotateRightArrow = true;
          break;
        case 'Space':
          if (!event.repeat) {
            sendSitAction();
          }
          changed = false;
          break;
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }

      event.preventDefault();
      if (changed) {
        applyKeyboardState();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const keyboard = keyboardStateRef.current;
      let handled = true;
      let changed = false;

      switch (event.code) {
        case 'KeyW':
          changed = keyboard.forward;
          keyboard.forward = false;
          break;
        case 'KeyS':
          changed = keyboard.backward;
          keyboard.backward = false;
          break;
        case 'KeyA':
          changed = keyboard.left;
          keyboard.left = false;
          break;
        case 'KeyD':
          changed = keyboard.right;
          keyboard.right = false;
          break;
        case 'KeyQ':
          changed = keyboard.rotateLeftKey;
          keyboard.rotateLeftKey = false;
          break;
        case 'ArrowLeft':
          changed = keyboard.rotateLeftArrow;
          keyboard.rotateLeftArrow = false;
          break;
        case 'KeyE':
          changed = keyboard.rotateRightKey;
          keyboard.rotateRightKey = false;
          break;
        case 'ArrowRight':
          changed = keyboard.rotateRightArrow;
          keyboard.rotateRightArrow = false;
          break;
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }

      event.preventDefault();
      if (changed) {
        applyKeyboardState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [applyKeyboardState, sendSitAction, stopAll]);

  const keycapClass = 'flex h-6 w-6 items-center justify-center rounded-md border border-border-subtle bg-surface-primary/85 text-[9px] font-medium uppercase tracking-[0.14em] text-text-label';
  const movementBlock = (
    <div className="pointer-events-auto flex items-center gap-3">
      <div className="flex flex-col items-center gap-2">
        <div
          ref={padRef}
          role="presentation"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={PAD_SOCKET_CLASS}
        >
          <div
            className={`${STICK_KNOB_CLASS} transition-transform ${isDragging ? 'scale-[1.02]' : ''}`}
            style={{
              width: `${MOVE_KNOB_SIZE}px`,
              height: `${MOVE_KNOB_SIZE}px`,
              transform: `translate(-50%, -50%) translate(${joystick.x * KNOB_TRAVEL}px, ${joystick.y * KNOB_TRAVEL}px)`
            }}
          />
        </div>
      </div>
      {showHints && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-center">
            <div className={keycapClass}>W</div>
          </div>
          <div className="flex gap-1">
            <div className={keycapClass}>A</div>
            <div className={keycapClass}>S</div>
            <div className={keycapClass}>D</div>
          </div>
        </div>
      )}
    </div>
  );
  const rotationBlock = (
    <div className="pointer-events-auto flex items-center gap-3">
      <div className="flex flex-col items-center">
        <div
          ref={rotationRef}
          role="slider"
          aria-label="Rotation"
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuenow={yaw}
          onPointerDown={handleRotationPointerDown}
          onPointerMove={handleRotationPointerMove}
          onPointerUp={handleRotationPointerUp}
          onPointerCancel={handleRotationPointerUp}
          className={ROTATION_SOCKET_CLASS}
        >
          <div
            className={`${STICK_KNOB_CLASS} transition-transform ${isRotating ? 'scale-[1.02]' : ''}`}
            style={{
              width: `${ROTATION_KNOB_SIZE}px`,
              height: `${ROTATION_KNOB_SIZE}px`,
              transform: `translate(-50%, -50%) translate(${-yawNormalized * ROTATION_KNOB_TRAVEL}px, 0)`
            }}
          />
        </div>
      </div>
      {showHints && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <div className={keycapClass}>Q</div>
            <div className={keycapClass}>E</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex w-full select-none items-center justify-between gap-4 text-[10px] text-text-secondary">
      {reverseOrder ? rotationBlock : movementBlock}
      {reverseOrder ? movementBlock : rotationBlock}
    </div>
  );
});

export default YahboomDogzillaLiteDesktopMovementPanel;
