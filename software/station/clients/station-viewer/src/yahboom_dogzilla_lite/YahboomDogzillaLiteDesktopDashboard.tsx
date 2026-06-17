import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Scan } from 'lucide-react';
import { commandManager } from '@/api/commands.js';
import { yahboom_dogzilla_lite } from '@/api/proto.js';
import CameraHudControls from '@/st3215/CameraHudControls';
import YahboomDogzillaLiteDesktopActionPanel from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopActionPanel';
import YahboomDogzillaLiteDesktopMovementPanel from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopMovementPanel';
import type { YahboomDogzillaLiteViewMode } from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewModeSwitch';
import YahboomDogzillaLiteViewer from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewer';
import { getYahboomDogzillaLiteModelLabel } from '@/yahboom_dogzilla_lite/model-labels';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getGradientClass } from '@/utils/color-utils';

const DEFAULT_SERVO_POSITIONS = [
  128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110,
  0, 255, 0
];

const SERVO_IDS = [
  '11', '12', '13',
  '21', '22', '23',
  '31', '32', '33',
  '41', '42', '43',
  '51', '52', '53'
];

const LEG_CONTROLS = [
  { id: '13', name: 'Shoulder' },
  { id: '12', name: 'Arm' },
  { id: '11', name: 'Elbow' }
];

const ARM_CONTROLS = [
  { id: '53', name: 'Shoulder' },
  { id: '52', name: 'Elbow' },
  { id: '51', name: 'Gripper' }
];

const LEG_PANELS = [
  { title: 'Leg 1 - Front Left', legId: '1' },
  { title: 'Leg 2 - Front Right', legId: '2' },
  { title: 'Leg 3 - Rear Right', legId: '3' },
  { title: 'Leg 4 - Rear Left', legId: '4' }
];

const PANEL_CLASS_NAME = 'min-w-0 rounded-lg border border-border-default bg-surface-primary/72 p-3 backdrop-blur';
const SLIDER_ROW_CLASS_NAME = 'grid grid-cols-[2rem_minmax(0,1fr)_2.25rem] items-center gap-2 text-xs text-text-label';
const SPEED_SLIDER_ROW_CLASS_NAME = 'grid grid-cols-[2.75rem_minmax(0,1fr)_2.25rem] items-center gap-2 text-xs text-text-label';
const SLIDER_ID_CLASS_NAME = 'py-1.5 font-bold text-accent-success-deep tabular-nums';
const SLIDER_LABEL_CLASS_NAME = 'py-1.5 text-text-label';
const SLIDER_CELL_CLASS_NAME = 'min-w-0 py-1.5';
const SPEED_SLIDER_CELL_CLASS_NAME = 'min-w-0 py-1.5';
const SLIDER_VALUE_CLASS_NAME = 'py-1.5 text-right tabular-nums text-accent-info';
const MANUAL_SLIDER_SYNC_HOLD_MS = 1500;
const SLIDER_REPEAT_DELAY_MS = 180;
const SLIDER_REPEAT_INTERVAL_MS = 35;
const noop = () => undefined;

const formatAcceleration = (value: number | null | undefined) => {
  const formattedValue = (value ?? 0).toFixed(1);
  return formattedValue === '-0.0' ? '0.0' : formattedValue;
};

type CameraLayoutMode = 'pip' | 'side-by-side' | 'stacked';
type CameraFitMode = 'contain' | 'cover';

interface YahboomDogzillaLiteDesktopDashboardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState | null;
  refreshToken?: number;
  primaryCameraSourceId?: string | null;
  secondaryCameraSourceId?: string | null;
  mainViewMode?: YahboomDogzillaLiteViewMode;
  cameraLayout?: CameraLayoutMode;
  primaryCameraFit?: CameraFitMode;
  secondaryCameraFit?: CameraFitMode;
  onPrimaryCameraFitToggle?: () => void;
  onSecondaryCameraFitToggle?: () => void;
  onSetPipLayout?: () => void;
  onToggleSplitLayout?: () => void;
  onSwapCameras?: () => void;
  onToggleFullscreen?: () => void;
}

interface PanelCardProps {
  title: string;
  className?: string;
  children: ReactNode;
}

interface ServoPanelControl {
  key: string;
  index: number;
  servoId: string;
}

interface ServoPanelProps {
  title: string;
  controls: ServoPanelControl[];
  displayPositions: number[];
  onChange: (index: number, value: number) => void;
}

interface SliderControlProps {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

function SliderControl({
  ariaLabel,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 255,
  className = 'mt-1'
}: SliderControlProps) {
  const valueRef = useRef(value);
  const repeatDelayRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const percentage = ((value - min) / (max - min)) * 100;
  const boundedPercentage = Math.max(0, Math.min(100, percentage));
  const buttonClassName = 'h-6 w-6 rounded bg-surface-tertiary text-xs font-bold text-text-primary transition-colors hover:bg-surface-elevated active:bg-surface-active';

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    if (repeatDelayRef.current !== null) {
      window.clearTimeout(repeatDelayRef.current);
    }
    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current);
    }
  }, []);

  const stepValue = (delta: number) => {
    const nextValue = Math.max(min, Math.min(max, valueRef.current + delta));
    valueRef.current = nextValue;
    onChange(nextValue);
    onCommit?.(nextValue);
  };
  const stopRepeat = () => {
    if (repeatDelayRef.current !== null) {
      window.clearTimeout(repeatDelayRef.current);
      repeatDelayRef.current = null;
    }
    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  };
  const startRepeat = (delta: number) => {
    stopRepeat();
    stepValue(delta);
    repeatDelayRef.current = window.setTimeout(() => {
      repeatDelayRef.current = null;
      repeatIntervalRef.current = window.setInterval(() => stepValue(delta), SLIDER_REPEAT_INTERVAL_MS);
    }, SLIDER_REPEAT_DELAY_MS);
  };

  return (
    <div className={`relative flex items-center gap-1 ${className}`.trim()}>
      <button
        type="button"
        className={buttonClassName}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          startRepeat(-1);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          stopRepeat();
        }}
        onPointerCancel={stopRepeat}
        onPointerLeave={stopRepeat}
        title={`Decrease ${ariaLabel}`}
      >
        -
      </button>
      <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-surface-secondary hover:bg-surface-tertiary">
        <div
          className={`h-full transition-all duration-200 ${getGradientClass(boundedPercentage)}`}
          style={{ width: `${boundedPercentage}%`, pointerEvents: 'none' }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-text-primary shadow-sm"
          style={{ left: `${boundedPercentage}%`, pointerEvents: 'none' }}
        />
        <input
          aria-label={ariaLabel}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onMouseUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          onTouchEnd={(event) => onCommit?.(Number(event.currentTarget.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <button
        type="button"
        className={buttonClassName}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          startRepeat(1);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          stopRepeat();
        }}
        onPointerCancel={stopRepeat}
        onPointerLeave={stopRepeat}
        title={`Increase ${ariaLabel}`}
      >
        +
      </button>
    </div>
  );
}

function PanelCard({ title, className = '', children }: PanelCardProps) {
  return (
    <section className={`${PANEL_CLASS_NAME} ${className}`.trim()}>
      <h3 className="flex min-h-6 items-center truncate pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-data">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ServoPanel({ title, controls, displayPositions, onChange }: ServoPanelProps) {
  return (
    <PanelCard title={title}>
      <div className="mt-1 space-y-2">
        {controls.map((control) => {
          const position = displayPositions[control.index] ?? 128;
          return (
            <div key={control.key} className={SLIDER_ROW_CLASS_NAME}>
              <span className={SLIDER_ID_CLASS_NAME}>
                {control.servoId}
              </span>
              <div className={SLIDER_CELL_CLASS_NAME}>
                <SliderControl
                  ariaLabel={`Servo ${control.servoId}`}
                  value={position}
                  onChange={(value) => onChange(control.index, value)}
                  className=""
                />
              </div>
              <span className={SLIDER_VALUE_CLASS_NAME}>
                {position}
              </span>
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}

const YahboomDogzillaLiteDesktopDashboard = memo(function YahboomDogzillaLiteDesktopDashboard({
  deviceState,
  refreshToken,
  primaryCameraSourceId = null,
  secondaryCameraSourceId = null,
  mainViewMode = '3d',
  cameraLayout = 'pip',
  primaryCameraFit = 'contain',
  secondaryCameraFit = 'contain',
  onPrimaryCameraFitToggle = noop,
  onSecondaryCameraFitToggle = noop,
  onSetPipLayout = noop,
  onToggleSplitLayout = noop,
  onSwapCameras = noop,
  onToggleFullscreen = noop
}: YahboomDogzillaLiteDesktopDashboardProps) {
  const fullscreenRootRef = useRef<HTMLDivElement | null>(null);
  const manualServoEditAtRef = useRef(DEFAULT_SERVO_POSITIONS.map(() => 0));
  const manualLegsSpeedEditAtRef = useRef(0);
  const manualArmSpeedEditAtRef = useRef(0);
  const [servoPositions, setServoPositions] = useState(DEFAULT_SERVO_POSITIONS);
  const [legsSpeed, setLegsSpeed] = useState(128);
  const [armSpeed, setArmSpeed] = useState(128);

  const status = deviceState?.status ?? null;
  const device = deviceState?.device ?? null;

  const modelLabel = useMemo(() => getYahboomDogzillaLiteModelLabel(device?.model), [device?.model]);

  const livePositions = useMemo(() => {
    if (!status?.servoPositions || status.servoPositions.length < 15) {
      return null;
    }
    return status.servoPositions.slice(0, 15).map((value) => Number(value));
  }, [status?.servoPositions]);

  const liveAngles = useMemo(() => {
    if (!status?.servoAngles || status.servoAngles.length < 15) {
      return null;
    }
    return status.servoAngles.slice(0, 15).map((value) => Number(value));
  }, [status?.servoAngles]);

  const displayPositions = servoPositions;

  const sendServoCommand = (servoId: number, position: number) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servo: { servoId, position }
    });
  };

  const sendLegsSpeedCommand = (bodySpeed: number) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { bodyServoSpeed: bodySpeed }
    });
  };

  const sendArmSpeedCommand = (armServoSpeed: number) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { armServoSpeed }
    });
  };

  useEffect(() => {
    const nowMs = Date.now();
    if (livePositions) {
      setServoPositions((currentPositions) => (
        currentPositions.map((currentPosition, index) => {
          const livePosition = livePositions[index] ?? currentPosition;
          const hasRecentManualEdit = nowMs - manualServoEditAtRef.current[index] < MANUAL_SLIDER_SYNC_HOLD_MS;

          return hasRecentManualEdit && livePosition !== currentPosition ? currentPosition : livePosition;
        })
      ));
    }
    if (status?.legServoSpeed !== null && status?.legServoSpeed !== undefined) {
      setLegsSpeed((currentSpeed) => {
        const hasRecentManualEdit = nowMs - manualLegsSpeedEditAtRef.current < MANUAL_SLIDER_SYNC_HOLD_MS;
        return hasRecentManualEdit && status.legServoSpeed !== currentSpeed ? currentSpeed : status.legServoSpeed!;
      });
    }
    if (status?.armServoSpeed !== null && status?.armServoSpeed !== undefined) {
      setArmSpeed((currentSpeed) => {
        const hasRecentManualEdit = nowMs - manualArmSpeedEditAtRef.current < MANUAL_SLIDER_SYNC_HOLD_MS;
        return hasRecentManualEdit && status.armServoSpeed !== currentSpeed ? currentSpeed : status.armServoSpeed!;
      });
    }
  }, [livePositions, status?.armServoSpeed, status?.legServoSpeed]);

  useEffect(() => {
    if (mainViewMode === 'fullscreenVideo') {
      fullscreenRootRef.current?.focus({ preventScroll: true });
    }
  }, [mainViewMode]);

  const updateServo = (index: number, value: number) => {
    const servoId = Number(SERVO_IDS[index]);
    if (!Number.isNaN(servoId)) {
      manualServoEditAtRef.current[index] = Date.now();
      setServoPositions((currentPositions) => {
        const nextPositions = [...currentPositions];
        nextPositions[index] = value;
        return nextPositions;
      });
      sendServoCommand(servoId, value);
    }
  };

  const updateLegsSpeed = (value: number) => {
    manualLegsSpeedEditAtRef.current = Date.now();
    setLegsSpeed(value);
  };

  const updateArmSpeed = (value: number) => {
    manualArmSpeedEditAtRef.current = Date.now();
    setArmSpeed(value);
  };

  const commitLegsSpeedChange = (value = legsSpeed) => {
    sendLegsSpeedCommand(value);
  };

  const commitArmSpeedChange = (value = armSpeed) => {
    sendArmSpeedCommand(value);
  };

  const armControls = ARM_CONTROLS.map((control) => ({
    key: control.id,
    index: SERVO_IDS.indexOf(control.id),
    servoId: control.id
  }));

  const batteryPercent = status?.batteryLevel ?? null;
  const batteryFill = batteryPercent === null ? 0 : Math.min(100, Math.max(0, batteryPercent));
  const batteryClass = batteryFill < 20 ? 'bg-accent-critical-deep' : batteryFill < 50 ? 'bg-accent-warning-deep' : 'bg-accent-success-deep';

  const renderStatusPanel = () => (
    <PanelCard title="Status">
      <div className="mt-1 space-y-2 text-xs text-text-secondary">
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">Model</span>
          <span className="truncate text-text-primary">{modelLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">Firmware</span>
          <span className="truncate text-text-primary">{device?.firmwareVersion || status?.firmwareVersion || '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">Battery</span>
          <span className="font-mono text-accent-data">
            {batteryPercent === null ? '—' : `${batteryFill}%`}
          </span>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded bg-surface-secondary">
        <div className={`h-full transition-all ${batteryClass}`} style={{ width: `${batteryFill}%` }} />
      </div>
    </PanelCard>
  );

  const renderImuPanel = () => (
    <PanelCard title="IMU Data">
      <div className="mt-1 grid gap-3 text-xs text-text-secondary">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-label">Orientation (deg)</div>
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Roll</span>
              <span className="font-mono text-accent-data">{Math.round(status?.orientation?.roll ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Pitch</span>
              <span className="font-mono text-accent-data">{Math.round(status?.orientation?.pitch ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Yaw</span>
              <span className="font-mono text-accent-data">{Math.round(status?.orientation?.yaw ?? 0)}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-label">Acceleration</div>
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">X</span>
              <span className="font-mono text-accent-data">{formatAcceleration(status?.acceleration?.x)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Y</span>
              <span className="font-mono text-accent-data">{formatAcceleration(status?.acceleration?.y)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Z</span>
              <span className="font-mono text-accent-data">{formatAcceleration(status?.acceleration?.z)}</span>
            </div>
          </div>
        </div>
      </div>
    </PanelCard>
  );

  const renderSpeedPanel = () => (
    <PanelCard title="Speed">
      <div className="mt-1 space-y-2">
        <div className={SPEED_SLIDER_ROW_CLASS_NAME}>
          <span className={SLIDER_LABEL_CLASS_NAME}>Legs</span>
          <div className={SPEED_SLIDER_CELL_CLASS_NAME}>
            <SliderControl
              ariaLabel="Leg servo speed"
              value={legsSpeed}
              onChange={updateLegsSpeed}
              onCommit={commitLegsSpeedChange}
              className=""
            />
          </div>
          <span className={SLIDER_VALUE_CLASS_NAME}>
            {legsSpeed}
          </span>
        </div>
        <div className={SPEED_SLIDER_ROW_CLASS_NAME}>
          <span className={SLIDER_LABEL_CLASS_NAME}>Arm</span>
          <div className={SPEED_SLIDER_CELL_CLASS_NAME}>
            <SliderControl
              ariaLabel="Arm servo speed"
              value={armSpeed}
              onChange={updateArmSpeed}
              onCommit={commitArmSpeedChange}
              className=""
            />
          </div>
          <span className={SLIDER_VALUE_CLASS_NAME}>
            {armSpeed}
          </span>
        </div>
      </div>
    </PanelCard>
  );

  const renderArmPanel = () => (
    <ServoPanel
      title="Robotic Arm"
      controls={armControls}
      displayPositions={displayPositions}
      onChange={updateServo}
    />
  );

  const renderLegPanel = (title: string, legId: string) => {
    const controls = LEG_CONTROLS.map((control) => {
      const servoId = control.id.replace('1', legId);
      return {
        key: servoId,
        index: SERVO_IDS.indexOf(servoId),
        servoId
      };
    });

    return (
      <ServoPanel
        title={title}
        controls={controls}
        displayPositions={displayPositions}
        onChange={updateServo}
      />
    );
  };

  const hasPrimaryCamera = Boolean(primaryCameraSourceId);
  const hasSecondaryCamera = Boolean(secondaryCameraSourceId);
  const isSplitCameraLayout =
    hasPrimaryCamera &&
    hasSecondaryCamera &&
    (cameraLayout === 'side-by-side' || cameraLayout === 'stacked');
  const isStackedCameraLayout = cameraLayout === 'stacked';

  const renderFitButton = (
    fit: CameraFitMode,
    onToggle: () => void,
    label: string,
    className = 'right-3 top-12'
  ) => (
    <button
      type="button"
      onClick={onToggle}
      className={`absolute z-30 flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle shadow-lg backdrop-blur-sm transition-colors ${
        fit === 'cover'
          ? 'bg-accent-data/90 text-surface-base hover:text-surface-base'
          : 'bg-surface-primary/75 text-text-muted hover:text-text-primary'
      } ${className}`}
      title={`${label}: ${fit}`}
      aria-label={`Toggle ${label} fit`}
    >
      <Scan className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  const renderCameraPane = (
    sourceId: string,
    fit: CameraFitMode,
    onFitToggle: () => void,
    label: string,
    overlay: 'none' | 'fps' = 'fps'
  ) => {
    const fitButtonClassName = overlay === 'none' ? 'right-3 top-3' : 'right-3 top-12';

    return (
      <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-black">
        <CameraViewer
          sourceId={sourceId}
          className="h-full w-full"
          imageClassName="select-none"
          fit={fit}
          overlay={overlay}
        />
        {renderFitButton(fit, onFitToggle, label, fitButtonClassName)}
        <div className="absolute bottom-3 left-3 z-20 rounded-md border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm">
          {label}
        </div>
      </div>
    );
  };

  const renderCameraStage = () => {
    if (!primaryCameraSourceId) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-primary/30 p-6 text-center">
          <div className="text-sm font-bold uppercase tracking-[0.18em] text-accent-warning">
            No camera selected
          </div>
          <p className="max-w-md text-xs text-text-muted">
            Select an active USB video source in the title bar to use the camera operator view.
          </p>
        </div>
      );
    }

    if (isSplitCameraLayout) {
      return (
        <div
          className={`grid h-full w-full ${
            isStackedCameraLayout ? 'grid-rows-2' : 'grid-cols-2'
          }`}
        >
          <div
            className={`min-h-0 min-w-0 border-border-default ${
              isStackedCameraLayout ? 'border-b' : 'border-r'
            }`}
          >
            {renderCameraPane(
              primaryCameraSourceId,
              primaryCameraFit,
              onPrimaryCameraFitToggle,
              'Main'
            )}
          </div>
          <div className="min-h-0 min-w-0">
            {renderCameraPane(
              secondaryCameraSourceId!,
              secondaryCameraFit,
              onSecondaryCameraFitToggle,
              'Aux'
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        {renderCameraPane(
          primaryCameraSourceId,
          primaryCameraFit,
          onPrimaryCameraFitToggle,
          'Main'
        )}
        {secondaryCameraSourceId && (
          <div className="absolute bottom-4 right-4 z-30 h-[34%] min-h-[9rem] w-[36%] min-w-[16rem] max-w-[26rem] overflow-hidden rounded-lg border-2 border-border-default bg-surface-primary shadow-2xl">
            {renderCameraPane(
              secondaryCameraSourceId,
              secondaryCameraFit,
              onSecondaryCameraFitToggle,
              'Aux',
              'none'
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCameraHudControls = () => (
    <CameraHudControls
      cameraLayout={cameraLayout}
      hasMotors={false}
      showMotorData={false}
      isFullscreen={mainViewMode === 'fullscreenVideo'}
      canSwapCameras={Boolean(primaryCameraSourceId && secondaryCameraSourceId)}
      onSetPipLayout={onSetPipLayout}
      onToggleSplitLayout={onToggleSplitLayout}
      onSwapCameras={onSwapCameras}
      onToggleMotorData={noop}
      onToggleFullscreen={onToggleFullscreen}
    />
  );

  const renderRobotContent = (className?: string) => (
    <YahboomDogzillaLiteViewer
      status={status}
      servoPositions={displayPositions}
      servoAngles={liveAngles}
      refreshToken={refreshToken}
      className={className}
    />
  );

  if (mainViewMode === 'fullscreenVideo' && primaryCameraSourceId) {
    return (
      <div
        ref={fullscreenRootRef}
        tabIndex={-1}
        className="fixed inset-0 z-50 overflow-hidden bg-surface-primary text-text-primary outline-none"
      >
        <div className="relative h-full w-full">
          {renderCameraStage()}
          {renderCameraHudControls()}
        </div>
        <div hidden>
          <YahboomDogzillaLiteDesktopMovementPanel
            deviceSerial={device?.serialNumber ?? ''}
            showHints={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[44rem] flex-col gap-3 overflow-hidden rounded-b-lg bg-surface-secondary/28 p-3 text-text-primary">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[15rem_minmax(0,1fr)_22rem] 2xl:grid-cols-[16rem_minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {renderStatusPanel()}
          {renderImuPanel()}
          {renderSpeedPanel()}
        </div>

        <div className="min-h-0">
          <div className="relative h-full min-h-[28rem] overflow-hidden rounded-lg border border-border-default bg-surface-primary/16">
            {mainViewMode === 'photo' && primaryCameraSourceId ? (
              renderCameraStage()
            ) : renderRobotContent()}
            {mainViewMode === '3d' && primaryCameraSourceId && (
              <div className="pointer-events-auto absolute right-4 top-4 z-10 h-[200px] w-[320px] max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-border-default bg-surface-primary shadow-lg">
                <CameraViewer
                  sourceId={primaryCameraSourceId}
                  className="h-full w-full"
                  imageClassName="select-none"
                  fit="cover"
                  overlay="none"
                />
                <div className="absolute bottom-2 left-2 rounded bg-black/45 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm">
                  Camera
                </div>
              </div>
            )}
            {mainViewMode === 'photo' && primaryCameraSourceId && (
              renderCameraHudControls()
            )}
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
              <YahboomDogzillaLiteDesktopMovementPanel deviceSerial={device?.serialNumber ?? ''} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <YahboomDogzillaLiteDesktopActionPanel deviceSerial={device?.serialNumber ?? ''} />
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-5 gap-3">
        {renderArmPanel()}
        {LEG_PANELS.map((panel) => (
          <div key={panel.legId} className="min-w-0">
            {renderLegPanel(panel.title, panel.legId)}
          </div>
        ))}
      </div>
    </div>
  );
});

export default YahboomDogzillaLiteDesktopDashboard;
