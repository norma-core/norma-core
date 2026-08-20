import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Long from 'long';
import {
  Activity,
  ArrowLeftRight,
  Camera,
  Crosshair,
  Gauge,
  Maximize2,
  Minimize2,
  Octagon,
  Power,
  X,
} from 'lucide-react';
import type { FrameEntry } from '@/api/frame-parser';
import { serverToLocal } from '@/api/timestamp-utils';
import { pwm_output, usbvideo, vesc_trampa, victron_smartsolar_mppt } from '@/api/proto.js';
import { useElementFullscreen } from '@/hooks';
import {
  holdVescTrampaMotor,
  setVescTrampaCurrent,
} from '@/devices/vesc-trampa/commands';
import { parseVescTrampaValuesPayload } from '@/devices/vesc-trampa/values-parser';
import { formatVescTrampaUuid, shortVescTrampaUuid } from '@/devices/vesc-trampa/utils';
import {
  PWM_OUTPUT_DEFAULT_CHANNEL,
  PWM_OUTPUT_DEFAULT_PERIOD_US,
  PWM_OUTPUT_DEFAULT_REPEAT,
  PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
  PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  PWM_OUTPUT_STEERING_CENTER_DEG,
  clampPwmOutputSteeringDeg,
  disablePwmOutput,
  pwmOutputPulseWidthForSteeringDeg,
  setPwmOutputSteeringAngle,
} from '@/devices/pwm-output/commands';
import {
  EMPTY_STATE,
  applyEnvelope,
  type VictronState,
} from '@/devices/victron-smartsolar-mppt/values';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId, getVideoSourceLabel } from '@/usbvideo/camera-source';
import {
  JOYSTICK_MAX_DRIVE_CURRENT_A,
  KEYBOARD_MAX_DRIVE_CURRENT_A,
  mapRoverControlInput,
} from '../control-input';
import RoverDriveSummary from './RoverDriveSummary';
import RoverEnergyFlow from './RoverEnergyFlow';
import RoverTelemetryDetails from './RoverTelemetryDetails';

const CONTROL_SEND_INTERVAL_MS = 50;
const JOYSTICK_TRAVEL_PERCENT = 34;
const JOYSTICK_DEAD_ZONE = 0.12;

interface BoardOption {
  key: string;
  label: string;
  uuid: Uint8Array;
  state: vesc_trampa.InferenceState.IBoardState;
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
}

interface CameraOption {
  id: string;
  label: string;
  sourceId: string;
}

type CameraLayout = 'pip' | 'split';

export interface VescPwmOutputControlPanelProps {
  vesc: vesc_trampa.IInferenceState;
  pwmOutputRx?: pwm_output.IRxEnvelope;
  pwmOutputTx?: pwm_output.ITxEnvelope;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  powerSources?: FrameEntry<victron_smartsolar_mppt.IRxEnvelope>[];
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
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function boardOptionsFromState(vesc: vesc_trampa.IInferenceState): BoardOption[] {
  return (vesc.boards ?? [])
    .map((state, index) => {
      const board = state.board;
      const uuid = board?.uuid ?? new Uint8Array();
      const uuidKey = uuid.length > 0 ? formatVescTrampaUuid(uuid) : '';
      return {
        key: uuidKey || board?.portName || String(index),
        label: uuid.length > 0 ? shortVescTrampaUuid(uuid) : board?.portName || `board-${index + 1}`,
        uuid,
        state,
      };
    })
    .filter((board) => board.uuid.length > 0);
}

function buildControlState(currentA: number, steeringDeg: number): ControlState {
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

function applyJoystickDeadZone(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
  const scaledMagnitude = Math.min(1, (magnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE));
  return {
    x: (x / magnitude) * scaledMagnitude,
    y: (y / magnitude) * scaledMagnitude,
  };
}

function formatAge(stampNs: Long | number | null | undefined): { label: string; stale: boolean } {
  if (!stampNs) return { label: '--', stale: true };
  const localStamp = serverToLocal(Long.fromValue(stampNs));
  const ageMs = Math.max(0, Date.now() - localStamp.toNumber() / 1e6);
  return {
    label: ageMs < 1000 ? `${ageMs.toFixed(0)}ms` : `${(ageMs / 1000).toFixed(1)}s`,
    stale: ageMs > 5000,
  };
}

function CameraPane({ camera, overlay = 'fps' }: { camera: CameraOption; overlay?: 'none' | 'fps' }) {
  return (
    <figure className="relative h-full min-h-0 min-w-0 overflow-hidden bg-black">
      <CameraViewer
        sourceId={camera.sourceId}
        className="h-full w-full"
        imageClassName="select-none"
        fit="cover"
        overlay={overlay}
      />
      <figcaption className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-md border border-border-default bg-surface-primary/62 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-text-secondary shadow-sm backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:left-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[42%] [@media(max-width:1023px)_and_(orientation:landscape)]:-translate-x-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30">
        {camera.label}
      </figcaption>
    </figure>
  );
}

const VescPwmOutputControlPanel = memo(function VescPwmOutputControlPanel({
  vesc,
  pwmOutputRx,
  pwmOutputTx,
  videoSources = [],
  powerSources = [],
}: VescPwmOutputControlPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen, exitFullscreen } = useElementFullscreen(rootRef);
  const boards = useMemo(() => boardOptionsFromState(vesc), [vesc]);
  const outputIds = useMemo(() => outputIdsFromFrame(pwmOutputRx, pwmOutputTx), [pwmOutputRx, pwmOutputTx]);
  const cameraOptions = useMemo<CameraOption[]>(() => videoSources.map((entry) => ({
    id: getVideoSourceId(entry),
    sourceId: getVideoSourceId(entry),
    label: getVideoSourceLabel(entry),
  })), [videoSources]);

  const [selectedBoardKey, setSelectedBoardKey] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [primaryCameraId, setPrimaryCameraId] = useState('');
  const [secondaryCameraId, setSecondaryCameraId] = useState('');
  const [cameraLayout, setCameraLayout] = useState<CameraLayout>('pip');
  const [showSecondaryCamera, setShowSecondaryCamera] = useState(true);
  const [isRemoteFullscreen, setIsRemoteFullscreen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [controlState, setControlState] = useState<ControlState>(() => buildControlState(0, PWM_OUTPUT_STEERING_CENTER_DEG));
  const [powerState, setPowerState] = useState<VictronState>(EMPTY_STATE);

  const keyboardRef = useRef<KeyboardState>(createKeyboardState());
  const draggingRef = useRef(false);
  const loopRef = useRef<number | null>(null);
  const controlStateRef = useRef(controlState);
  const boardUuidRef = useRef<Uint8Array>(new Uint8Array());
  const outputIdRef = useRef('');
  const lastSentRef = useRef<ControlState>({
    currentA: Number.NaN,
    steeringDeg: Number.NaN,
    pulseWidthUs: Number.NaN,
  });
  const powerAppStartRef = useRef('');

  const selectedBoard = boards.find((board) => board.key === selectedBoardKey) ?? boards[0] ?? null;
  const selectedBoardKeyValue = selectedBoard?.key ?? '';
  const selectedOutputIdValue = outputIds.includes(selectedOutputId) ? selectedOutputId : outputIds[0] ?? '';
  const primaryCamera = cameraOptions.find((camera) => camera.id === primaryCameraId) ?? cameraOptions[0] ?? null;
  const secondaryCamera = cameraOptions.find((camera) => camera.id === secondaryCameraId)
    ?? cameraOptions.find((camera) => camera.id !== primaryCamera?.id)
    ?? null;
  const canSendVesc = Boolean(selectedBoard?.uuid.length);
  const canSendSteering = Boolean(selectedOutputIdValue);
  const isControlActive = controlState.currentA !== 0 || controlState.steeringDeg !== PWM_OUTPUT_STEERING_CENTER_DEG;
  const valuesResult = useMemo(
    () => parseVescTrampaValuesPayload(selectedBoard?.state.valuesPayload),
    [selectedBoard?.state.valuesPayload],
  );
  const values = valuesResult.values;
  const valuesAge = formatAge(selectedBoard?.state.valuesMonotonicStampNs);
  const faultCode = values?.faultCode ?? 0;
  const hasFault = faultCode !== 0 || Boolean(pwmOutputRx?.error) || Boolean(valuesResult.error);
  const ready = canSendVesc && canSendSteering && !valuesAge.stale && !hasFault;

  useEffect(() => {
    if (!boards.some((board) => board.key === selectedBoardKey)) setSelectedBoardKey(boards[0]?.key ?? '');
  }, [boards, selectedBoardKey]);

  useEffect(() => {
    if (!outputIds.includes(selectedOutputId)) setSelectedOutputId(outputIds[0] ?? '');
  }, [outputIds, selectedOutputId]);

  useEffect(() => {
    const ids = cameraOptions.map((camera) => camera.id);
    const primary = ids.includes(primaryCameraId) ? primaryCameraId : ids[0] ?? '';
    if (primary !== primaryCameraId) setPrimaryCameraId(primary);
    if (!ids.includes(secondaryCameraId) || secondaryCameraId === primary) {
      setSecondaryCameraId(ids.find((id) => id !== primary) ?? '');
    }
  }, [cameraOptions, primaryCameraId, secondaryCameraId]);

  useEffect(() => {
    boardUuidRef.current = selectedBoard?.uuid ?? new Uint8Array();
  }, [selectedBoard]);

  useEffect(() => {
    outputIdRef.current = selectedOutputIdValue;
  }, [selectedOutputIdValue]);

  useEffect(() => {
    const envelope = powerSources[0]?.data;
    if (!envelope) return;
    const appStart = envelope.appStartId?.toString() ?? '';
    const reset = powerAppStartRef.current !== appStart;
    powerAppStartRef.current = appStart;
    setPowerState((current) => applyEnvelope(reset ? EMPTY_STATE : current, envelope));
  }, [powerSources]);

  const reportCommandError = useCallback((label: string, error: unknown) => {
    console.error(label, error);
    setCommandError(label);
  }, []);

  const sendControl = useCallback((next: ControlState, force = false, updateUi = true) => {
    controlStateRef.current = next;
    if (updateUi) setControlState(next);
    const boardUuid = boardUuidRef.current;
    if (boardUuid.length > 0 && (force || next.currentA !== lastSentRef.current.currentA)) {
      void setVescTrampaCurrent(boardUuid, next.currentA).catch((error) => reportCommandError('Drive command failed', error));
    }
    const outputId = outputIdRef.current;
    if (outputId && (force || next.steeringDeg !== lastSentRef.current.steeringDeg)) {
      void setPwmOutputSteeringAngle(
        outputId,
        PWM_OUTPUT_DEFAULT_CHANNEL,
        next.steeringDeg,
        PWM_OUTPUT_DEFAULT_PERIOD_US,
        PWM_OUTPUT_DEFAULT_REPEAT,
        PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
        PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
      ).catch((error) => reportCommandError('Steering command failed', error));
    }
    lastSentRef.current = next;
  }, [reportCommandError]);

  const stopControlLoop = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const ensureControlLoop = useCallback(() => {
    if (loopRef.current !== null) return;
    loopRef.current = window.setInterval(() => sendControl(controlStateRef.current, true, false), CONTROL_SEND_INTERVAL_MS);
  }, [sendControl]);

  const applyControlTarget = useCallback((
    x: number,
    y: number,
    maxDriveCurrentA: number,
    displayX = x,
    displayY = y,
  ) => {
    setJoystick({ x: displayX, y: displayY });
    const target = mapRoverControlInput(x, y, maxDriveCurrentA);
    const next = buildControlState(target.currentA, target.steeringDeg);
    sendControl(next);
    if (next.currentA !== 0 || next.steeringDeg !== PWM_OUTPUT_STEERING_CENTER_DEG) ensureControlLoop();
    else stopControlLoop();
  }, [ensureControlLoop, sendControl, stopControlLoop]);

  const applyNormalizedControls = useCallback((x: number, y: number) => {
    const normalized = applyJoystickDeadZone(
      Math.max(-1, Math.min(1, x)),
      Math.max(-1, Math.min(1, y)),
    );
    applyControlTarget(
      normalized.x,
      normalized.y,
      JOYSTICK_MAX_DRIVE_CURRENT_A,
    );
  }, [applyControlTarget]);

  const stopAll = useCallback(() => {
    keyboardRef.current = createKeyboardState();
    draggingRef.current = false;
    setIsDragging(false);
    setJoystick({ x: 0, y: 0 });
    sendControl(buildControlState(0, PWM_OUTPUT_STEERING_CENTER_DEG), true);
    stopControlLoop();
  }, [sendControl, stopControlLoop]);

  useEffect(() => {
    const handleVisibility = () => { if (document.visibilityState !== 'visible') stopAll(); };
    const handleBlur = () => stopAll();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handleBlur);
      stopAll();
    };
  }, [stopAll]);

  useEffect(() => {
    if (!isRemoteFullscreen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [isRemoteFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isRemoteFullscreen) setIsRemoteFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isRemoteFullscreen]);

  const applyKeyboardState = useCallback(() => {
    const keyboard = keyboardRef.current;
    const x = (keyboard.right ? 1 : 0) - (keyboard.left ? 1 : 0);
    const y = (keyboard.backward ? 1 : 0) - (keyboard.forward ? 1 : 0);
    const magnitude = Math.hypot(x, y);
    applyControlTarget(
      x,
      y,
      KEYBOARD_MAX_DRIVE_CURRENT_A,
      magnitude > 1 ? x / magnitude : x,
      magnitude > 1 ? y / magnitude : y,
    );
  }, [applyControlTarget]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (detailsOpen || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
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
  }, [applyKeyboardState, detailsOpen, stopAll]);

  const updateFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    applyNormalizedControls(x, y);
  }, [applyNormalizedControls]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setCommandError(null);
    draggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  }, [updateFromPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) updateFromPointer(event);
  }, [updateFromPointer]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    stopAll();
  }, [stopAll]);

  const holdMotor = useCallback(async () => {
    if (!selectedBoard?.uuid.length) return;
    stopAll();
    setIsHolding(true);
    setCommandError(null);
    try { await holdVescTrampaMotor(selectedBoard.uuid); }
    catch (error) { reportCommandError('Hold command failed', error); }
    finally { setIsHolding(false); }
  }, [reportCommandError, selectedBoard, stopAll]);

  const disableSteering = useCallback(async () => {
    const outputId = outputIdRef.current;
    if (!outputId) return;
    stopAll();
    setCommandError(null);
    try { await disablePwmOutput(outputId, PWM_OUTPUT_DEFAULT_CHANNEL); }
    catch (error) { reportCommandError('Disable command failed', error); }
  }, [reportCommandError, stopAll]);

  const centerSteering = useCallback(() => {
    keyboardRef.current.left = false;
    keyboardRef.current.right = false;
    const currentA = controlStateRef.current.currentA;
    setJoystick((current) => ({ x: 0, y: current.y }));
    sendControl(buildControlState(currentA, PWM_OUTPUT_STEERING_CENTER_DEG), true);
    if (currentA !== 0) ensureControlLoop();
    else stopControlLoop();
  }, [ensureControlLoop, sendControl, stopControlLoop]);

  const handlePrimaryCameraChange = useCallback((nextId: string) => {
    if (nextId === secondaryCamera?.id) setSecondaryCameraId(primaryCamera?.id ?? '');
    setPrimaryCameraId(nextId);
  }, [primaryCamera?.id, secondaryCamera?.id]);

  const swapCameras = useCallback(() => {
    if (!primaryCamera || !secondaryCamera) return;
    setPrimaryCameraId(secondaryCamera.id);
    setSecondaryCameraId(primaryCamera.id);
  }, [primaryCamera, secondaryCamera]);

  const openDetails = useCallback(() => {
    stopAll();
    setDetailsOpen(true);
  }, [stopAll]);

  const handleRemoteFullscreenToggle = useCallback(() => {
    if (isRemoteFullscreen) {
      setIsRemoteFullscreen(false);
      if (isFullscreen) void exitFullscreen();
      return;
    }
    setIsRemoteFullscreen(true);
    if (window.matchMedia('(min-width: 1024px)').matches) void toggleFullscreen();
  }, [exitFullscreen, isFullscreen, isRemoteFullscreen, toggleFullscreen]);

  const knobLeft = 50 + joystick.x * JOYSTICK_TRAVEL_PERCENT;
  const knobTop = 50 + joystick.y * JOYSTICK_TRAVEL_PERCENT;
  const activeSecondaryCamera = showSecondaryCamera ? secondaryCamera : null;
  const actionButtonClass = 'flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border-default bg-surface-secondary/60 px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-text-primary transition hover:border-accent-data/50 hover:bg-accent-data/8 active:scale-[0.98] active:bg-accent-data/14 disabled:cursor-not-allowed disabled:opacity-35';

  const cameraStage = !primaryCamera ? (
    <div className="flex h-full items-center justify-center bg-surface-base text-center text-sm text-text-muted">
      <div><Camera className="mx-auto mb-3 h-7 w-7" />Waiting for rover camera</div>
    </div>
  ) : activeSecondaryCamera && cameraLayout === 'split' ? (
    <div className="grid h-full grid-rows-2 gap-px bg-border-default sm:grid-cols-2 sm:grid-rows-1">
      <CameraPane camera={primaryCamera} />
      <CameraPane camera={activeSecondaryCamera} />
    </div>
  ) : (
    <div className="relative h-full">
      <CameraPane camera={primaryCamera} />
      {activeSecondaryCamera && (
        <div className="absolute bottom-3 right-3 z-20 h-[32%] min-h-20 w-[36%] min-w-28 overflow-hidden rounded-lg border border-accent-data/35 bg-surface-base shadow-[0_1rem_2.5rem_rgba(0,0,0,0.28)]">
          <CameraPane camera={activeSecondaryCamera} overlay="none" />
        </div>
      )}
    </div>
  );

  return (
    <section
      ref={rootRef}
      data-remote-fullscreen={isRemoteFullscreen ? 'true' : undefined}
      aria-label="Rover control"
      className="group/dashboard relative isolate h-[calc(100svh-8.6rem)] min-h-[34rem] w-full overflow-hidden bg-surface-base text-text-primary data-[remote-fullscreen=true]:!fixed data-[remote-fullscreen=true]:!inset-0 data-[remote-fullscreen=true]:!z-[60] data-[remote-fullscreen=true]:!m-0 data-[remote-fullscreen=true]:!h-[100svh] data-[remote-fullscreen=true]:!min-h-0 data-[remote-fullscreen=true]:!w-screen data-[remote-fullscreen=true]:!rounded-none data-[remote-fullscreen=true]:!border-0 lg:h-[min(84vh,58rem)] lg:min-h-[42rem] lg:rounded-lg lg:border lg:border-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:h-[calc(100svh-7.6rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[15rem] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-xl [&:fullscreen]:!fixed [&:fullscreen]:!inset-0 [&:fullscreen]:!z-[60] [&:fullscreen]:!m-0 [&:fullscreen]:!h-[100svh] [&:fullscreen]:!min-h-0 [&:fullscreen]:!w-screen [&:fullscreen]:!rounded-none [&:fullscreen]:!border-0"
    >
      <div className="grid h-full grid-rows-[minmax(15rem,54%)_minmax(0,46%)] lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-1 [@media(max-width:1023px)_and_(orientation:landscape)]:block">
        <div className="relative min-h-0 overflow-hidden bg-black [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0">
          {cameraStage}
          <div className="pointer-events-none absolute inset-0 z-10 hidden [background:radial-gradient(circle_at_18%_82%,rgba(34,211,238,0.14),transparent_27%),radial-gradient(circle_at_84%_78%,rgba(34,211,238,0.10),transparent_24%),linear-gradient(90deg,rgba(0,0,0,0.30),transparent_32%,transparent_68%,rgba(0,0,0,0.30)),linear-gradient(180deg,rgba(0,0,0,0.18),transparent_34%,rgba(0,0,0,0.22))] [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden="true" />
          <span className="pointer-events-none absolute left-[0.55rem] top-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-l-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
          <span className="pointer-events-none absolute right-[0.55rem] top-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-r-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
          <span className="pointer-events-none absolute bottom-[0.55rem] left-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-b-2 border-l-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
          <span className="pointer-events-none absolute bottom-[0.55rem] right-[0.55rem] z-20 hidden h-[0.95rem] w-[0.95rem] border-b-2 border-r-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
          <div className="absolute left-2 right-2 top-2 z-40 flex items-start justify-between gap-2">
            <button type="button" onClick={openDetails} aria-label="Open rover status" className="flex min-w-0 items-center gap-2 rounded-md border border-accent-data/35 bg-surface-primary/55 px-2.5 py-2 text-left shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md transition hover:border-accent-data/60 hover:bg-surface-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-data">
              <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? 'bg-accent-success' : hasFault ? 'bg-accent-critical' : 'bg-accent-warning'}`} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-text-primary">Rover</div>
                <div className="max-w-28 truncate font-mono text-[8px] uppercase tracking-wide text-text-muted">
                  {selectedBoard?.label ?? 'no drive'} · {selectedOutputIdValue || 'no steering'}
                </div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-accent-data/35 bg-surface-primary/55 p-1 shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] backdrop-blur-md">
              {cameraOptions.length > 1 ? (
                <select
                  aria-label="Main camera"
                  value={primaryCamera?.id ?? ''}
                  onChange={(event) => handlePrimaryCameraChange(event.target.value)}
                  className="h-8 max-w-24 rounded border-0 bg-surface-secondary px-2 font-mono text-[9px] font-bold text-text-primary outline-none"
                >
                  {cameraOptions.map((camera, index) => <option key={camera.id} value={camera.id}>CAM {index + 1}</option>)}
                </select>
              ) : <span className="px-2 font-mono text-[9px] font-bold text-text-secondary">CAM {cameraOptions.length || '--'}</span>}
              {secondaryCamera && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowSecondaryCamera((current) => !current)}
                    className={`flex h-8 w-8 items-center justify-center rounded transition ${showSecondaryCamera ? 'bg-accent-data text-surface-base' : 'text-text-secondary hover:bg-surface-tertiary/75'}`}
                    aria-label={showSecondaryCamera ? 'Hide auxiliary camera' : 'Show auxiliary camera'}
                  >
                    <span className="relative h-4 w-4 rounded-sm border border-current"><span className="absolute -bottom-px -right-px h-2 w-2 rounded-[1px] border border-current bg-current/20" /></span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCameraLayout((current) => current === 'pip' ? 'split' : 'pip')}
                    className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-surface-tertiary/75"
                    aria-label={cameraLayout === 'pip' ? 'Use split camera layout' : 'Use picture-in-picture layout'}
                  >
                    <span className={`grid h-4 w-4 gap-px ${cameraLayout === 'split' ? 'grid-cols-2' : 'grid-cols-[1fr_0.45fr]'}`}><span className="rounded-[1px] border border-current" /><span className="rounded-[1px] border border-current" /></span>
                  </button>
                  <button type="button" onClick={swapCameras} className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-surface-tertiary/75" aria-label="Swap cameras">
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              <button type="button" onClick={handleRemoteFullscreenToggle} className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-accent-data/12 hover:text-accent-data" aria-label={isRemoteFullscreen ? 'Exit fullscreen rover control' : 'Fullscreen rover control'} aria-pressed={isRemoteFullscreen}>
                {isRemoteFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <aside className="relative flex min-h-0 flex-col border-t border-border-default bg-surface-primary/95 lg:border-l lg:border-t-0 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0 [@media(max-width:1023px)_and_(orientation:landscape)]:z-30 [@media(max-width:1023px)_and_(orientation:landscape)]:border-0 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-transparent">
          <div className="shrink-0 border-b border-border-default bg-surface-secondary/45 px-3 py-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:left-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:top-2 [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(24rem,calc(100%-20rem))] [@media(max-width:1023px)_and_(orientation:landscape)]:-translate-x-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-md [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-black/72 [@media(max-width:1023px)_and_(orientation:landscape)]:py-2 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.28)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
            <RoverEnergyFlow
              values={powerState.textValues}
              fallbackBatteryVoltageV={values?.inputVoltageV}
              linkLabel={valuesAge.label}
              linkStale={valuesAge.stale}
            />
          </div>

          <RoverDriveSummary
            values={values}
            ready={ready}
            hasFault={hasFault}
            ageLabel={valuesAge.label}
          />

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(9.5rem,1fr)_minmax(8rem,0.82fr)] items-center gap-3 px-3 py-3 lg:flex lg:flex-col lg:justify-center lg:gap-4 lg:px-6 lg:py-5 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-x-2 [@media(max-width:1023px)_and_(orientation:landscape)]:bottom-2 [@media(max-width:1023px)_and_(orientation:landscape)]:flex [@media(max-width:1023px)_and_(orientation:landscape)]:items-end [@media(max-width:1023px)_and_(orientation:landscape)]:justify-between [@media(max-width:1023px)_and_(orientation:landscape)]:p-0">
            <div className="pointer-events-auto min-w-0 select-none [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(11rem,22vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/45 [@media(max-width:1023px)_and_(orientation:landscape)]:p-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
              <div className="mb-1.5 flex items-center justify-between gap-2 px-1 [@media(max-width:1023px)_and_(orientation:landscape)]:mb-1 [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.58rem]">
                <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.16em] text-text-label [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">Drive + steer</span>
                <span className="hidden whitespace-nowrap font-bold uppercase tracking-[0.12em] text-text-label [@media(max-width:1023px)_and_(orientation:landscape)]:inline">Drive</span>
                <span className={`font-mono text-[9px] font-bold uppercase [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.58rem] ${isControlActive ? 'text-accent-data' : 'text-text-muted'}`}>{isControlActive ? '[ live ]' : '[ idle ]'}</span>
              </div>
              <div className="mb-1 hidden text-center font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted lg:block">WASD · ±10A limit</div>
              <div
                ref={padRef}
                role="slider"
                aria-label="Rover drive and steering"
                aria-valuetext={`${controlState.currentA.toFixed(1)} amps, ${controlState.steeringDeg} degrees`}
                tabIndex={0}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onLostPointerCapture={(event) => { if (draggingRef.current) handlePointerEnd(event); }}
                className="relative mx-auto aspect-square h-[clamp(8.5rem,38vw,10.5rem)] touch-none rounded-full border border-border-default bg-surface-base shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25),inset_0_0_3rem_rgba(34,211,238,0.06)] outline-none focus-visible:ring-2 focus-visible:ring-accent-data lg:h-48 [@media(max-width:1023px)_and_(orientation:landscape)]:h-[min(27vmin,10.5rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-base/30 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45),inset_0_0_4rem_rgba(34,211,238,0.08),0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[min(24vmin,9rem)]"
              >
                <span className="pointer-events-none absolute -left-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-l-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
                <span className="pointer-events-none absolute -right-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-r-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
                <span className="pointer-events-none absolute -bottom-1 -left-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-l-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
                <span className="pointer-events-none absolute -bottom-1 -right-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-r-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
                <span className="pointer-events-none absolute inset-[18%] rounded-full border border-border-subtle" />
                <span className="pointer-events-none absolute inset-[34%] rounded-full border border-border-subtle" />
                <span className="pointer-events-none absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-border-default" />
                <span className="pointer-events-none absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-border-default" />
                <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-[8px] font-black uppercase tracking-[0.18em] text-accent-data/75">Fwd</span>
                <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">Rev</span>
                <span
                  className={`pointer-events-none absolute h-[31%] w-[31%] -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0.6rem_1.4rem_rgba(0,0,0,0.24)] transition-[transform,background-color,border-color] duration-75 ${isDragging ? 'scale-105 border-accent-data bg-accent-data shadow-[0_0_0.8rem_rgba(34,211,238,0.45)]' : 'border-accent-data/70 bg-accent-data/10'}`}
                  style={{ left: `${knobLeft}%`, top: `${knobTop}%` }}
                />
              </div>
            </div>

            <div className="pointer-events-auto flex min-w-0 flex-col gap-2 lg:w-full [@media(max-width:1023px)_and_(orientation:landscape)]:w-40 [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/45 [@media(max-width:1023px)_and_(orientation:landscape)]:p-2 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
              <button type="button" onClick={stopAll} disabled={!canSendVesc && !canSendSteering} className="flex min-h-14 items-center justify-center gap-2 rounded-md border border-accent-critical-deep bg-accent-critical/12 px-3 text-xs font-black uppercase tracking-[0.12em] text-accent-critical transition hover:border-accent-critical hover:bg-accent-critical/20 active:scale-[0.98] active:bg-accent-critical/25 disabled:opacity-35 [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-11">
                <Octagon className="h-4 w-4" />Stop
              </button>
              <div className="hidden grid-cols-2 gap-2 lg:grid">
                <button type="button" className={actionButtonClass} onClick={centerSteering} disabled={!canSendSteering}><Crosshair className="h-3.5 w-3.5" />Center</button>
                <button type="button" className={actionButtonClass} onClick={() => void holdMotor()} disabled={!canSendVesc || isHolding}><Octagon className="h-3.5 w-3.5" />{isHolding ? 'Wait' : 'Hold'}</button>
                <button type="button" className={actionButtonClass} onClick={() => void disableSteering()} disabled={!canSendSteering}><Power className="h-3.5 w-3.5" />Disable</button>
                <button type="button" className={actionButtonClass} onClick={openDetails}><Gauge className="h-3.5 w-3.5" />Status</button>
              </div>
              <div className="grid grid-cols-2 border-y border-border-default py-1.5 font-mono tabular-nums lg:grid-cols-3">
                <div className="border-r border-border-default px-1 text-center">
                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Drive</div>
                  <div className={`mt-0.5 text-[11px] font-bold lg:text-[10px] ${controlState.currentA === 0 ? 'text-text-secondary' : 'text-accent-data'}`}>{controlState.currentA.toFixed(1)}A</div>
                </div>
                <div className="px-1 text-center lg:border-r lg:border-border-default">
                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Steer</div>
                  <div className={`mt-0.5 text-[11px] font-bold lg:text-[10px] ${controlState.steeringDeg === PWM_OUTPUT_STEERING_CENTER_DEG ? 'text-text-secondary' : 'text-accent-data'}`}>{controlState.steeringDeg}°</div>
                </div>
                <div className="hidden px-1 text-center lg:block">
                  <div className="text-[7px] font-bold uppercase tracking-[0.12em] text-text-muted">Pulse</div>
                  <div className="mt-0.5 text-[10px] font-bold text-text-secondary">{controlState.pulseWidthUs}µs</div>
                </div>
              </div>
              {commandError && <div className="truncate rounded bg-accent-critical/12 px-2 py-1.5 text-[9px] font-semibold text-accent-critical">{commandError}</div>}
            </div>
          </div>
        </aside>
      </div>

      {detailsOpen && (
        <div className="absolute inset-0 z-[70] overflow-y-auto bg-surface-primary/98 text-text-primary backdrop-blur-xl">
          <div className="sticky top-0 z-20 border-b border-border-default bg-surface-primary/92 px-4 py-3 backdrop-blur-xl sm:px-6">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em]"><Activity className="h-4 w-4 text-accent-data" />Rover status</div>
                <div className="mt-1 font-mono text-[10px] text-text-muted">Live drivetrain, steering and power diagnostics</div>
              </div>
              <button type="button" onClick={() => setDetailsOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-md border border-border-default bg-surface-secondary/60 text-text-secondary transition hover:border-accent-data hover:text-accent-data" aria-label="Close rover status"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
            <section className="mb-4 border-b border-border-default pb-4">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-accent-data">Control targets</h3>
              <div className="grid gap-x-8 md:grid-cols-2">
                <label className="block py-2.5">
                  <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">Drive board</span>
                  <select value={selectedBoardKeyValue} onChange={(event) => { stopAll(); setSelectedBoardKey(event.target.value); }} className="h-10 w-full rounded-md border border-border-default bg-surface-secondary/60 px-3 font-mono text-xs text-text-primary outline-none focus:border-accent-data focus:ring-1 focus:ring-accent-data">
                    {boards.map((board) => <option key={board.key} value={board.key}>{board.label}</option>)}
                  </select>
                </label>
                <label className="block py-2.5">
                  <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">Steering output</span>
                  <select value={selectedOutputIdValue} onChange={(event) => { stopAll(); setSelectedOutputId(event.target.value); }} className="h-10 w-full rounded-md border border-border-default bg-surface-secondary/60 px-3 font-mono text-xs text-text-primary outline-none focus:border-accent-data focus:ring-1 focus:ring-accent-data">
                    {outputIds.map((outputId) => <option key={outputId} value={outputId}>{outputId}</option>)}
                  </select>
                </label>
              </div>
            </section>
            <RoverTelemetryDetails
              boardState={selectedBoard?.state ?? null}
              values={values}
              valuesError={valuesResult.error}
              pwmOutputRx={pwmOutputRx}
              pwmOutputTx={pwmOutputTx}
              powerState={powerState}
              powerEnvelope={powerSources[0]?.data}
            />
          </div>
        </div>
      )}
    </section>
  );
});

export default VescPwmOutputControlPanel;
