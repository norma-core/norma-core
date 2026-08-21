import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Joystick, Octagon, Power } from 'lucide-react';
import { pwm_output, vesc_trampa } from '@/api/proto.js';
import {
  VESC_TRAMPA_CURRENT_MAX_A,
  holdVescTrampaMotor,
  setVescTrampaCurrent,
} from '@/devices/vesc-trampa/commands';
import { formatVescTrampaUuid, shortVescTrampaUuid } from '@/devices/vesc-trampa/utils';
import {
  PWM_OUTPUT_DEFAULT_CHANNEL,
  PWM_OUTPUT_DEFAULT_LEFT_STEERING_DEG,
  PWM_OUTPUT_DEFAULT_PERIOD_US,
  PWM_OUTPUT_DEFAULT_REPEAT,
  PWM_OUTPUT_DEFAULT_RIGHT_STEERING_DEG,
  PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
  PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  PWM_OUTPUT_STEERING_CENTER_DEG,
  PWM_OUTPUT_STEERING_MAX_DEG,
  PWM_OUTPUT_STEERING_MIN_DEG,
  clampPwmOutputSteeringDeg,
  disablePwmOutput,
  pwmOutputPulseWidthForSteeringDeg,
  setPwmOutputSteeringAngle,
} from '@/devices/pwm-output/commands';

const CONTROL_SEND_INTERVAL_MS = 50;
const DRIVE_CURRENT_A = VESC_TRAMPA_CURRENT_MAX_A;

interface BoardOption {
  key: string;
  label: string;
  uuid: Uint8Array;
}

interface KeyboardState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

interface ControlState {
  currentA: number;
  steeringDeg: number;
  pulseWidthUs: number;
  channel: number;
  periodUs: number;
  repeat: number;
}

export interface VescPwmOutputControlPanelProps {
  vesc: vesc_trampa.IInferenceState;
  pwmOutputRx?: pwm_output.IRxEnvelope;
  pwmOutputTx?: pwm_output.ITxEnvelope;
}

const createKeyboardState = (): KeyboardState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
});

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
};

function outputIdsFromFrame(
  rx?: pwm_output.IRxEnvelope,
  tx?: pwm_output.ITxEnvelope,
): string[] {
  return [
    rx?.device?.id,
    rx?.state?.id,
    rx?.command?.targetOutputId,
    rx?.command?.command?.targetOutputId,
    tx?.targetOutputId,
    tx?.command?.targetOutputId,
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value, index, values) =>
      value.length > 0 && values.indexOf(value) === index,
    );
}

function boardOptionsFromState(vesc: vesc_trampa.IInferenceState): BoardOption[] {
  return (vesc.boards ?? [])
    .map((boardState, index) => {
      const board = boardState.board;
      const uuid = board?.uuid ?? new Uint8Array();
      const uuidKey = uuid.length > 0 ? formatVescTrampaUuid(uuid) : '';
      const fallbackKey = board?.portName || String(index);

      return {
        key: uuidKey || fallbackKey,
        label: uuid.length > 0
          ? shortVescTrampaUuid(uuid)
          : board?.portName || `board-${index + 1}`,
        uuid,
      };
    })
    .filter((board) => board.uuid.length > 0);
}

function steeringAngleForKeyboard(keyboard: KeyboardState): number | null {
  if (keyboard.left) {
    return PWM_OUTPUT_DEFAULT_LEFT_STEERING_DEG;
  }
  if (keyboard.right) {
    return PWM_OUTPUT_DEFAULT_RIGHT_STEERING_DEG;
  }
  return null;
}

function buildControlState(currentA: number, steeringDeg: number): ControlState {
  const clampedSteeringDeg = clampPwmOutputSteeringDeg(steeringDeg);

  return {
    currentA,
    steeringDeg: clampedSteeringDeg,
    pulseWidthUs: pwmOutputPulseWidthForSteeringDeg(
      clampedSteeringDeg,
      PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
      PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
      PWM_OUTPUT_DEFAULT_PERIOD_US,
    ),
    channel: PWM_OUTPUT_DEFAULT_CHANNEL,
    periodUs: PWM_OUTPUT_DEFAULT_PERIOD_US,
    repeat: PWM_OUTPUT_DEFAULT_REPEAT,
  };
}

const VescPwmOutputControlPanel = memo(function VescPwmOutputControlPanel({
  vesc,
  pwmOutputRx,
  pwmOutputTx,
}: VescPwmOutputControlPanelProps) {
  const boards = useMemo(() => boardOptionsFromState(vesc), [vesc]);
  const outputIds = useMemo(() => outputIdsFromFrame(pwmOutputRx, pwmOutputTx), [pwmOutputRx, pwmOutputTx]);
  const [selectedBoardKey, setSelectedBoardKey] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [debugSteeringDeg, setDebugSteeringDeg] = useState(PWM_OUTPUT_STEERING_CENTER_DEG);
  const [isDebugSteeringHeld, setIsDebugSteeringHeld] = useState(false);
  const [controlState, setControlState] = useState<ControlState>(() => buildControlState(
    0,
    PWM_OUTPUT_STEERING_CENTER_DEG,
  ));
  const [isHolding, setIsHolding] = useState(false);
  const keyboardRef = useRef<KeyboardState>(createKeyboardState());
  const loopRef = useRef<number | null>(null);
  const lastSentRef = useRef<ControlState>({
    currentA: Number.NaN,
    steeringDeg: Number.NaN,
    pulseWidthUs: Number.NaN,
    channel: Number.NaN,
    periodUs: Number.NaN,
    repeat: Number.NaN,
  });
  const debugSteeringRef = useRef(debugSteeringDeg);
  const debugSteeringHeldRef = useRef(isDebugSteeringHeld);
  const controlStateRef = useRef(controlState);
  const boardUuidRef = useRef<Uint8Array>(new Uint8Array());
  const outputIdRef = useRef('');

  const selectedBoard = boards.find((board) => board.key === selectedBoardKey) ?? boards[0] ?? null;
  const effectiveSelectedBoardKey = selectedBoard?.key ?? '';
  const effectiveSelectedOutputId = outputIds.includes(selectedOutputId) ? selectedOutputId : outputIds[0] || '';
  const canSendVesc = Boolean(selectedBoard?.uuid.length);
  const canSendPwmOutput = Boolean(effectiveSelectedOutputId);
  const isSteeringActive = keyboardRef.current.left || keyboardRef.current.right || isDebugSteeringHeld;
  const isActive = controlState.currentA !== 0 || isSteeringActive;

  useEffect(() => {
    if (boards.length === 0) {
      setSelectedBoardKey('');
      return;
    }
    if (!boards.some((board) => board.key === selectedBoardKey)) {
      setSelectedBoardKey(boards[0].key);
    }
  }, [boards, selectedBoardKey]);

  useEffect(() => {
    if (outputIds.length === 0) {
      setSelectedOutputId('');
      return;
    }
    if (!outputIds.includes(selectedOutputId)) {
      setSelectedOutputId(outputIds[0]);
    }
  }, [selectedOutputId, outputIds]);

  useEffect(() => {
    debugSteeringRef.current = debugSteeringDeg;
  }, [debugSteeringDeg]);

  useEffect(() => {
    debugSteeringHeldRef.current = isDebugSteeringHeld;
  }, [isDebugSteeringHeld]);

  useEffect(() => {
    boardUuidRef.current = selectedBoard?.uuid ?? new Uint8Array();
  }, [selectedBoard]);

  useEffect(() => {
    outputIdRef.current = effectiveSelectedOutputId;
  }, [effectiveSelectedOutputId]);

  const sendControl = useCallback((
    next: ControlState,
    forceCurrent = false,
    sendSteering = true,
    forceSteering = false,
  ) => {
    controlStateRef.current = next;
    setControlState(next);

    const boardUuid = boardUuidRef.current;
    if (boardUuid.length > 0 && (forceCurrent || next.currentA !== lastSentRef.current.currentA)) {
      void setVescTrampaCurrent(boardUuid, next.currentA).catch((error) => {
        console.error('Failed to send VESC current command:', error);
      });
    }

    const outputId = outputIdRef.current;
    const waveChanged = next.steeringDeg !== lastSentRef.current.steeringDeg
      || next.pulseWidthUs !== lastSentRef.current.pulseWidthUs
      || next.channel !== lastSentRef.current.channel
      || next.periodUs !== lastSentRef.current.periodUs
      || next.repeat !== lastSentRef.current.repeat;
    if (sendSteering && outputId && (forceSteering || waveChanged)) {
      void setPwmOutputSteeringAngle(
        outputId,
        next.channel,
        next.steeringDeg,
        next.periodUs,
        next.repeat,
        PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
        PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
      ).catch((error) => {
        console.error('Failed to send PWM output command:', error);
      });
    }

    lastSentRef.current = {
      currentA: next.currentA,
      steeringDeg: sendSteering ? next.steeringDeg : lastSentRef.current.steeringDeg,
      pulseWidthUs: sendSteering ? next.pulseWidthUs : lastSentRef.current.pulseWidthUs,
      channel: sendSteering ? next.channel : lastSentRef.current.channel,
      periodUs: sendSteering ? next.periodUs : lastSentRef.current.periodUs,
      repeat: sendSteering ? next.repeat : lastSentRef.current.repeat,
    };
  }, []);

  const buildNextControl = useCallback(() => {
    const keyboard = keyboardRef.current;
    const throttleDirection = (keyboard.backward ? 1 : 0) - (keyboard.forward ? 1 : 0);
    const keyboardSteeringDeg = steeringAngleForKeyboard(keyboard);
    const steeringDeg = debugSteeringHeldRef.current
      ? debugSteeringRef.current
      : keyboardSteeringDeg;
    const next = buildControlState(
      Number((throttleDirection * DRIVE_CURRENT_A).toFixed(1)),
      steeringDeg ?? controlStateRef.current.steeringDeg,
    );

    return {
      next,
      steeringActive: steeringDeg !== null,
    };
  }, []);

  const stopControlLoop = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const ensureControlLoop = useCallback(() => {
    if (loopRef.current !== null) {
      return;
    }

    loopRef.current = window.setInterval(() => {
      const { next, steeringActive } = buildNextControl();
      if (next.currentA === 0 && !steeringActive) {
        stopControlLoop();
        return;
      }

      sendControl(next, next.currentA !== 0, steeringActive, steeringActive);
    }, CONTROL_SEND_INTERVAL_MS);
  }, [buildNextControl, sendControl, stopControlLoop]);

  const applyControls = useCallback(() => {
    const { next, steeringActive } = buildNextControl();
    sendControl(next, false, steeringActive);

    if (next.currentA !== 0 || steeringActive) {
      ensureControlLoop();
    } else {
      stopControlLoop();
    }
  }, [buildNextControl, ensureControlLoop, sendControl, stopControlLoop]);

  const stopAll = useCallback(() => {
    keyboardRef.current = createKeyboardState();
    debugSteeringHeldRef.current = false;
    setIsDebugSteeringHeld(false);
    const next = buildControlState(0, controlStateRef.current.steeringDeg);
    sendControl(next, false, false);
    stopControlLoop();
  }, [sendControl, stopControlLoop]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        stopAll();
      }
    };

    const handleBlur = () => stopAll();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }

      const keyboard = keyboardRef.current;
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
          changed = !keyboard.left || keyboard.right;
          keyboard.left = true;
          keyboard.right = false;
          break;
        case 'KeyD':
          changed = !keyboard.right || keyboard.left;
          keyboard.left = false;
          keyboard.right = true;
          break;
        case 'Space':
          stopAll();
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
        applyControls();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const keyboard = keyboardRef.current;
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
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }

      event.preventDefault();
      if (changed) {
        applyControls();
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
  }, [applyControls, stopAll]);

  const setPressed = useCallback((key: keyof KeyboardState, pressed: boolean) => {
    if (keyboardRef.current[key] === pressed) {
      return;
    }
    if (pressed && key === 'left') {
      keyboardRef.current.right = false;
      debugSteeringHeldRef.current = false;
      setIsDebugSteeringHeld(false);
    }
    if (pressed && key === 'right') {
      keyboardRef.current.left = false;
      debugSteeringHeldRef.current = false;
      setIsDebugSteeringHeld(false);
    }
    keyboardRef.current[key] = pressed;
    applyControls();
  }, [applyControls]);

  const setDebugSteeringPressed = useCallback((pressed: boolean) => {
    if (debugSteeringHeldRef.current === pressed) {
      return;
    }
    if (pressed) {
      keyboardRef.current.left = false;
      keyboardRef.current.right = false;
    }
    debugSteeringHeldRef.current = pressed;
    setIsDebugSteeringHeld(pressed);
    applyControls();
  }, [applyControls]);

  const handleDebugSteeringChange = useCallback((value: string) => {
    const next = clampPwmOutputSteeringDeg(Number(value));
    setDebugSteeringDeg(next);
    debugSteeringRef.current = next;
    if (debugSteeringHeldRef.current) {
      applyControls();
    }
  }, [applyControls]);

  const centerSteering = useCallback(() => {
    keyboardRef.current.left = false;
    keyboardRef.current.right = false;
    debugSteeringHeldRef.current = false;
    setIsDebugSteeringHeld(false);
    const next = buildControlState(controlStateRef.current.currentA, PWM_OUTPUT_STEERING_CENTER_DEG);
    sendControl(next, false, true, true);
    if (next.currentA !== 0) {
      ensureControlLoop();
    } else {
      stopControlLoop();
    }
  }, [ensureControlLoop, sendControl, stopControlLoop]);

  const holdMotor = useCallback(async () => {
    if (!selectedBoard?.uuid.length) {
      return;
    }

    setIsHolding(true);
    try {
      stopAll();
      await holdVescTrampaMotor(selectedBoard.uuid);
    } finally {
      setIsHolding(false);
    }
  }, [selectedBoard, stopAll]);

  const disableOutput = useCallback(() => {
    const outputId = outputIdRef.current;
    if (!outputId) {
      return;
    }
    void disablePwmOutput(outputId, PWM_OUTPUT_DEFAULT_CHANNEL).catch((error) => {
      console.error('Failed to disable PWM output:', error);
    });
  }, []);

  const keycapClass = 'flex h-14 w-14 touch-none select-none items-center justify-center rounded border border-border-subtle bg-surface-primary text-base font-bold text-text-primary md:h-10 md:w-10 md:text-sm xl:h-8 xl:w-8 xl:text-xs';
  const actionButtonClass = 'inline-flex h-9 items-center justify-center gap-2 rounded border border-border-default bg-surface-secondary px-3 text-xs font-bold text-text-primary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50';
  const numberInputClass = 'h-9 w-24 rounded border border-border-subtle bg-surface-primary px-2 text-right font-mono text-xs text-text-primary';

  return (
    <section className="w-full rounded-lg border border-border-default bg-surface-primary/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default bg-surface-secondary/50 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Joystick className="h-4 w-4 text-accent-data" aria-hidden="true" />
            <h2 className="text-sm font-bold uppercase text-text-primary">Joystick</h2>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
              isActive
                ? 'border-accent-warning text-accent-warning'
                : 'border-border-subtle text-text-muted'
            }`}>
              {isActive ? 'active' : 'idle'}
            </span>
          </div>
          <div className="mt-1 min-w-0 truncate font-mono text-xs text-text-muted">
            {selectedBoard ? shortVescTrampaUuid(selectedBoard.uuid) : '--'} / {effectiveSelectedOutputId || '--'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={effectiveSelectedBoardKey}
            onChange={(event) => {
              stopAll();
              setSelectedBoardKey(event.target.value);
            }}
            className="h-9 min-w-32 rounded border border-border-subtle bg-surface-primary px-2 font-mono text-xs text-text-primary"
            disabled={boards.length <= 1}
            title={selectedBoard ? formatVescTrampaUuid(selectedBoard.uuid) : undefined}
          >
            {boards.map((board) => (
              <option key={board.key} value={board.key}>{board.label}</option>
            ))}
          </select>
          <select
            value={effectiveSelectedOutputId}
            onChange={(event) => {
              stopAll();
              setSelectedOutputId(event.target.value);
            }}
            className="h-9 min-w-32 rounded border border-border-subtle bg-surface-primary px-2 font-mono text-xs text-text-primary"
            disabled={outputIds.length <= 1}
          >
            {outputIds.map((outputId) => (
              <option key={outputId} value={outputId}>{outputId}</option>
            ))}
          </select>
          <button
            type="button"
            className={`${actionButtonClass} border-accent-critical/70 text-accent-critical hover:bg-accent-critical hover:text-text-primary`}
            onClick={stopAll}
            disabled={!canSendVesc && !canSendPwmOutput}
          >
            <Octagon className="h-4 w-4" aria-hidden="true" />
            Stop
          </button>
          <button
            type="button"
            className={actionButtonClass}
            onClick={centerSteering}
            disabled={!canSendPwmOutput}
          >
            <Crosshair className="h-4 w-4" aria-hidden="true" />
            Center
          </button>
          <button
            type="button"
            className={actionButtonClass}
            onClick={disableOutput}
            disabled={!canSendPwmOutput}
          >
            <Power className="h-4 w-4" aria-hidden="true" />
            Disable
          </button>
          <button
            type="button"
            className={`${actionButtonClass} border-accent-warning/70 text-accent-warning`}
            onClick={holdMotor}
            disabled={!canSendVesc || isHolding}
          >
            <Octagon className="h-4 w-4" aria-hidden="true" />
            {isHolding ? 'Hold...' : 'Hold'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <div className="flex items-center justify-center">
          <div className="grid grid-cols-3 gap-1">
            <div />
            <button
              type="button"
              className={`${keycapClass} ${keyboardRef.current.forward ? 'border-accent-warning text-accent-warning' : ''}`}
              onPointerDown={() => setPressed('forward', true)}
              onPointerUp={() => setPressed('forward', false)}
              onPointerCancel={() => setPressed('forward', false)}
              onPointerLeave={() => setPressed('forward', false)}
            >
              W
            </button>
            <div />
            <button
              type="button"
              className={`${keycapClass} ${keyboardRef.current.left ? 'border-accent-warning text-accent-warning' : ''}`}
              onPointerDown={() => setPressed('left', true)}
              onPointerUp={() => setPressed('left', false)}
              onPointerCancel={() => setPressed('left', false)}
              onPointerLeave={() => setPressed('left', false)}
            >
              A
            </button>
            <button
              type="button"
              className={`${keycapClass} ${keyboardRef.current.backward ? 'border-accent-warning text-accent-warning' : ''}`}
              onPointerDown={() => setPressed('backward', true)}
              onPointerUp={() => setPressed('backward', false)}
              onPointerCancel={() => setPressed('backward', false)}
              onPointerLeave={() => setPressed('backward', false)}
            >
              S
            </button>
            <button
              type="button"
              className={`${keycapClass} ${keyboardRef.current.right ? 'border-accent-warning text-accent-warning' : ''}`}
              onPointerDown={() => setPressed('right', true)}
              onPointerUp={() => setPressed('right', false)}
              onPointerCancel={() => setPressed('right', false)}
              onPointerLeave={() => setPressed('right', false)}
            >
              D
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))]">
          <div className="min-w-0 rounded border border-border-subtle bg-surface-secondary/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-text-muted">Drive</div>
            <div className="mt-1 font-mono text-sm text-text-primary">
              {controlState.currentA.toFixed(1)}A
            </div>
          </div>
          <div className="min-w-0 rounded border border-border-subtle bg-surface-secondary/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-text-muted">Steering</div>
            <div className="mt-1 font-mono text-sm text-text-primary">
              ch{controlState.channel} {controlState.steeringDeg}deg {controlState.pulseWidthUs}us
            </div>
          </div>
          <label className="min-w-0 rounded border border-border-subtle bg-surface-secondary/40 px-3 py-2">
            <span className="block text-[10px] font-bold uppercase text-text-muted">Debug deg</span>
            <input
              type="number"
              min={PWM_OUTPUT_STEERING_MIN_DEG}
              max={PWM_OUTPUT_STEERING_MAX_DEG}
              step={1}
              value={debugSteeringDeg}
              onChange={(event) => handleDebugSteeringChange(event.target.value)}
              className={`${numberInputClass} mt-1`}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className={`${actionButtonClass} h-10 w-full ${isDebugSteeringHeld ? 'border-accent-warning text-accent-warning' : ''}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDebugSteeringPressed(true);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                setDebugSteeringPressed(false);
              }}
              onPointerCancel={() => setDebugSteeringPressed(false)}
              onPointerLeave={() => setDebugSteeringPressed(false)}
              disabled={!canSendPwmOutput}
            >
              Hold deg
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

export default VescPwmOutputControlPanel;
