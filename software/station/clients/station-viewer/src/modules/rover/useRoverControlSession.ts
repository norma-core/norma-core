import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PWM_OUTPUT_DEFAULT_CHANNEL,
  PWM_OUTPUT_DEFAULT_PERIOD_US,
  PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
  PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  PWM_OUTPUT_STEERING_CENTER_DEG,
  clampPwmOutputSteeringDeg,
  disablePwmOutput,
  pwmOutputPulseWidthForSteeringDeg,
  setPwmOutputSteeringAngle,
} from '@/modules/pwm-output/commands';
import {
  holdVescTrampaMotor,
  setVescTrampaCurrent,
} from '@/modules/vesc-trampa/commands';
import {
  KEYBOARD_MAX_DRIVE_CURRENT_A,
  ROVER_DEFAULT_DRIVE_CURRENT_LIMIT_A,
  ROVER_MAX_DRIVE_CURRENT_A,
  ROVER_MIN_DRIVE_CURRENT_LIMIT_A,
  mapRoverControlInput,
  normalizeSquareJoystickInput,
} from './control-input';

const CONTROL_SEND_INTERVAL_MS = 50;
const CONTROL_COMMAND_HOLD_MS = 2_500;
const DRIVE_COMMAND_DURATION_MS = CONTROL_COMMAND_HOLD_MS;
const STEERING_COMMAND_REPEAT = Math.ceil((CONTROL_COMMAND_HOLD_MS * 1000) / PWM_OUTPUT_DEFAULT_PERIOD_US);
const JOYSTICK_DEAD_ZONE = 0.12;

interface KeyboardState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export interface RoverControlState {
  axes: { x: number; y: number };
  currentA: number;
  steeringDeg: number;
  pulseWidthUs: number;
  currentLimitA: number;
  active: boolean;
  touchActive: boolean;
  holding: boolean;
  error: string | null;
  canSendDrive: boolean;
  canSendSteering: boolean;
}

export interface RoverControlActions {
  startTouch: () => void;
  setTouchInput: (x: number, y: number) => void;
  releaseTouch: () => void;
  setCurrentLimit: (limitA: number) => void;
  stop: () => void;
  center: () => void;
  hold: () => Promise<void>;
  disableSteering: () => Promise<void>;
}

export interface RoverControlSession {
  state: RoverControlState;
  actions: RoverControlActions;
}

interface UseRoverControlSessionOptions {
  boardUuid: Uint8Array;
  steeringOutputId: string;
  suspended?: boolean;
}

interface ControlTarget {
  currentA: number;
  steeringDeg: number;
  pulseWidthUs: number;
}

interface PendingControlCommand {
  target: ControlTarget;
  forceDrive: boolean;
  forceSteering: boolean;
}

function createKeyboardState(): KeyboardState {
  return { forward: false, backward: false, left: false, right: false };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

function buildControlTarget(currentA: number, steeringDeg: number): ControlTarget {
  const clampedSteeringDeg = clampPwmOutputSteeringDeg(steeringDeg);
  return {
    currentA: Number(currentA.toFixed(1)),
    steeringDeg: clampedSteeringDeg,
    pulseWidthUs: pwmOutputPulseWidthForSteeringDeg(
      clampedSteeringDeg,
      PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
      PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
      PWM_OUTPUT_DEFAULT_PERIOD_US,
    ),
  };
}

const IDLE_TARGET = buildControlTarget(0, PWM_OUTPUT_STEERING_CENTER_DEG);

export function useRoverControlSession({
  boardUuid,
  steeringOutputId,
  suspended = false,
}: UseRoverControlSessionOptions): RoverControlSession {
  const [axes, setAxes] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<ControlTarget>(IDLE_TARGET);
  const [currentLimitA, setCurrentLimitA] = useState(ROVER_DEFAULT_DRIVE_CURRENT_LIMIT_A);
  const [touchActive, setTouchActive] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyboardRef = useRef<KeyboardState>(createKeyboardState());
  const touchActiveRef = useRef(false);
  const loopRef = useRef<number | null>(null);
  const targetRef = useRef(target);
  const boardUuidRef = useRef(boardUuid);
  const outputIdRef = useRef(steeringOutputId);
  const pendingCommandRef = useRef<PendingControlCommand | null>(null);
  const commandFlushActiveRef = useRef(false);
  const lastDriveCurrentRef = useRef(Number.NaN);
  const lastSteeringDegRef = useRef(Number.NaN);

  useEffect(() => {
    boardUuidRef.current = boardUuid;
  }, [boardUuid]);

  useEffect(() => {
    outputIdRef.current = steeringOutputId;
  }, [steeringOutputId]);

  const reportCommandError = useCallback((label: string, commandError: unknown) => {
    console.error(label, commandError);
    setError(label);
  }, []);

  const flushPendingCommands = useCallback(async () => {
    if (commandFlushActiveRef.current) return;
    commandFlushActiveRef.current = true;

    try {
      while (pendingCommandRef.current) {
        const pending = pendingCommandRef.current;
        pendingCommandRef.current = null;

        const driveUuid = boardUuidRef.current;
        const shouldSendDrive = driveUuid.length > 0 && (
          pending.forceDrive
          || pending.target.currentA !== lastDriveCurrentRef.current
        );
        const outputId = outputIdRef.current;
        const shouldSendSteering = Boolean(outputId) && (
          pending.forceSteering
          || pending.target.steeringDeg !== lastSteeringDegRef.current
        );

        const driveCommand = shouldSendDrive
          ? setVescTrampaCurrent(
            driveUuid,
            pending.target.currentA,
            {
              maxAbsCurrentA: ROVER_MAX_DRIVE_CURRENT_A,
              durationMs: pending.target.currentA === 0 ? 0 : DRIVE_COMMAND_DURATION_MS,
              finalCurrentA: 0,
            },
          ).then(() => {
            lastDriveCurrentRef.current = pending.target.currentA;
          }).catch((commandError) => {
            reportCommandError('Drive command failed', commandError);
          })
          : Promise.resolve();

        const steeringCommand = shouldSendSteering
          ? setPwmOutputSteeringAngle(
            outputId,
            PWM_OUTPUT_DEFAULT_CHANNEL,
            pending.target.steeringDeg,
            PWM_OUTPUT_DEFAULT_PERIOD_US,
            STEERING_COMMAND_REPEAT,
            PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
            PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
          ).then(() => {
            lastSteeringDegRef.current = pending.target.steeringDeg;
          }).catch((commandError) => {
            reportCommandError('Steering command failed', commandError);
          })
          : Promise.resolve();

        // Keep a single command batch in flight; the pending slot is coalesced to the latest target.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([driveCommand, steeringCommand]);
      }
    } finally {
      commandFlushActiveRef.current = false;
    }
  }, [reportCommandError]);

  const queueControl = useCallback((
    nextTarget: ControlTarget,
    force = false,
    updateUi = true,
  ) => {
    targetRef.current = nextTarget;
    if (updateUi) setTarget(nextTarget);

    const pending = pendingCommandRef.current;
    pendingCommandRef.current = {
      target: nextTarget,
      forceDrive: force || pending?.forceDrive === true,
      forceSteering: force || pending?.forceSteering === true,
    };
    void flushPendingCommands();
  }, [flushPendingCommands]);

  const stopControlLoop = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const ensureControlLoop = useCallback(() => {
    if (loopRef.current !== null) return;
    loopRef.current = window.setInterval(() => {
      queueControl(targetRef.current, true, false);
    }, CONTROL_SEND_INTERVAL_MS);
  }, [queueControl]);

  const applyControlInput = useCallback((
    x: number,
    y: number,
    maxDriveCurrentA: number,
  ) => {
    setAxes({ x, y });
    const mapped = mapRoverControlInput(x, y, maxDriveCurrentA);
    const nextTarget = buildControlTarget(mapped.currentA, mapped.steeringDeg);
    queueControl(nextTarget);
    if (nextTarget.currentA !== 0 || nextTarget.steeringDeg !== PWM_OUTPUT_STEERING_CENTER_DEG) {
      ensureControlLoop();
    } else {
      stopControlLoop();
    }
  }, [ensureControlLoop, queueControl, stopControlLoop]);

  const stopAll = useCallback((updateUi = true) => {
    keyboardRef.current = createKeyboardState();
    touchActiveRef.current = false;
    if (updateUi) {
      setTouchActive(false);
      setAxes({ x: 0, y: 0 });
    }
    queueControl(IDLE_TARGET, true, updateUi);
    stopControlLoop();
  }, [queueControl, stopControlLoop]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') stopAll();
    };
    const handleBlur = () => stopAll();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handleBlur);
      stopAll(false);
    };
  }, [stopAll]);

  useEffect(() => {
    if (suspended) stopAll();
  }, [stopAll, suspended]);

  const applyKeyboardState = useCallback(() => {
    const keyboard = keyboardRef.current;
    applyControlInput(
      (keyboard.right ? 1 : 0) - (keyboard.left ? 1 : 0),
      (keyboard.backward ? 1 : 0) - (keyboard.forward ? 1 : 0),
      KEYBOARD_MAX_DRIVE_CURRENT_A,
    );
  }, [applyControlInput]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspended || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
      const keyboard = keyboardRef.current;
      let changed = false;
      switch (event.code) {
        case 'KeyW': changed = !keyboard.forward; keyboard.forward = true; break;
        case 'KeyS': changed = !keyboard.backward; keyboard.backward = true; break;
        case 'KeyA': changed = !keyboard.left; keyboard.left = true; break;
        case 'KeyD': changed = !keyboard.right; keyboard.right = true; break;
        case 'Space': event.preventDefault(); stopAll(); return;
        default: return;
      }
      event.preventDefault();
      if (changed) applyKeyboardState();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const keyboard = keyboardRef.current;
      let changed = false;
      switch (event.code) {
        case 'KeyW': changed = keyboard.forward; keyboard.forward = false; break;
        case 'KeyS': changed = keyboard.backward; keyboard.backward = false; break;
        case 'KeyA': changed = keyboard.left; keyboard.left = false; break;
        case 'KeyD': changed = keyboard.right; keyboard.right = false; break;
        default: return;
      }
      event.preventDefault();
      if (changed) applyKeyboardState();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [applyKeyboardState, stopAll, suspended]);

  const startTouch = useCallback(() => {
    setError(null);
    touchActiveRef.current = true;
    setTouchActive(true);
  }, []);

  const setTouchInput = useCallback((x: number, y: number) => {
    const normalized = normalizeSquareJoystickInput(x, y, JOYSTICK_DEAD_ZONE);
    applyControlInput(normalized.x, normalized.y, currentLimitA);
  }, [applyControlInput, currentLimitA]);

  const releaseTouch = useCallback(() => {
    if (!touchActiveRef.current) return;
    stopAll();
  }, [stopAll]);

  const setSafeCurrentLimit = useCallback((nextLimitA: number) => {
    const clampedLimitA = Math.round(Math.max(
      ROVER_MIN_DRIVE_CURRENT_LIMIT_A,
      Math.min(ROVER_MAX_DRIVE_CURRENT_A, nextLimitA),
    ));
    if (clampedLimitA === currentLimitA) return;
    const currentTarget = targetRef.current;
    if (
      touchActiveRef.current
      || currentTarget.currentA !== 0
      || currentTarget.steeringDeg !== PWM_OUTPUT_STEERING_CENTER_DEG
    ) {
      stopAll();
    }
    setCurrentLimitA(clampedLimitA);
  }, [currentLimitA, stopAll]);

  const center = useCallback(() => {
    keyboardRef.current.left = false;
    keyboardRef.current.right = false;
    const currentTarget = targetRef.current;
    setAxes((current) => ({ x: 0, y: current.y }));
    const centeredTarget = buildControlTarget(
      currentTarget.currentA,
      PWM_OUTPUT_STEERING_CENTER_DEG,
    );
    queueControl(centeredTarget, true);
    if (centeredTarget.currentA !== 0) ensureControlLoop();
    else stopControlLoop();
  }, [ensureControlLoop, queueControl, stopControlLoop]);

  const hold = useCallback(async () => {
    const currentBoardUuid = boardUuidRef.current;
    if (currentBoardUuid.length === 0) return;
    stopAll();
    setHolding(true);
    setError(null);
    try {
      await holdVescTrampaMotor(currentBoardUuid);
    } catch (commandError) {
      reportCommandError('Hold command failed', commandError);
    } finally {
      setHolding(false);
    }
  }, [reportCommandError, stopAll]);

  const disableSteeringAction = useCallback(async () => {
    const outputId = outputIdRef.current;
    if (!outputId) return;
    stopAll();
    setError(null);
    try {
      await disablePwmOutput(outputId, PWM_OUTPUT_DEFAULT_CHANNEL);
    } catch (commandError) {
      reportCommandError('Disable command failed', commandError);
    }
  }, [reportCommandError, stopAll]);

  const active = target.currentA !== 0 || target.steeringDeg !== PWM_OUTPUT_STEERING_CENTER_DEG;
  const state = useMemo<RoverControlState>(() => ({
    axes,
    currentA: target.currentA,
    steeringDeg: target.steeringDeg,
    pulseWidthUs: target.pulseWidthUs,
    currentLimitA,
    active,
    touchActive,
    holding,
    error,
    canSendDrive: boardUuid.length > 0,
    canSendSteering: Boolean(steeringOutputId),
  }), [
    active,
    axes,
    boardUuid.length,
    currentLimitA,
    error,
    holding,
    steeringOutputId,
    target,
    touchActive,
  ]);

  const actions = useMemo<RoverControlActions>(() => ({
    startTouch,
    setTouchInput,
    releaseTouch,
    setCurrentLimit: setSafeCurrentLimit,
    stop: () => stopAll(),
    center,
    hold,
    disableSteering: disableSteeringAction,
  }), [
    center,
    disableSteeringAction,
    hold,
    releaseTouch,
    setSafeCurrentLimit,
    setTouchInput,
    startTouch,
    stopAll,
  ]);

  return { state, actions };
}
