import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { commandManager } from '@/api/commands.js';
import { yahboom_dogzilla_lite, usbvideo } from '@/api/proto.js';
import YahboomDogzillaLiteDesktopActionPanel from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopActionPanel';
import YahboomDogzillaLiteDesktopMovementPanel from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopMovementPanel';
import type { YahboomDogzillaLiteViewMode } from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewModeSwitch';
import YahboomDogzillaLiteViewer from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewer';
import { getYahboomDogzillaLiteModelLabel } from '@/yahboom_dogzilla_lite/model-labels';
import UsbCameraViewer from '@/usbvideo/CameraViewer';
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

const PANEL_CLASS_NAME = 'rounded-xl border border-border-default bg-surface-primary/80 p-3 backdrop-blur';
const SLIDER_ROW_CLASS_NAME = 'flex items-center gap-1 text-xs text-text-label';
const SLIDER_ID_CLASS_NAME = 'w-7 shrink-0 py-1.5 font-bold text-accent-success-deep tabular-nums';
const SLIDER_LABEL_CLASS_NAME = 'w-8 shrink-0 py-1.5 text-text-label';
const SLIDER_CELL_CLASS_NAME = 'min-w-[200px] flex-1 py-1.5';
const SPEED_SLIDER_CELL_CLASS_NAME = 'w-[170px] shrink-0 py-1.5';
const SLIDER_VALUE_CLASS_NAME = 'w-8 shrink-0 py-1.5 text-right tabular-nums text-accent-info';
const MANUAL_SLIDER_SYNC_HOLD_MS = 1500;
const SLIDER_REPEAT_DELAY_MS = 180;
const SLIDER_REPEAT_INTERVAL_MS = 35;

const formatAcceleration = (value: number | null | undefined) => {
  const formattedValue = (value ?? 0).toFixed(1);
  return formattedValue === '-0.0' ? '0.0' : formattedValue;
};

type SelectedVideoSource =
  | { kind: 'usbvideo'; source: usbvideo.IRxEnvelope; sourceId: string };

interface YahboomDogzillaLiteDesktopDashboardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState | null;
  refreshToken?: number;
  selectedVideoSource?: SelectedVideoSource;
  mainViewMode?: YahboomDogzillaLiteViewMode;
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
      <h3 className="flex min-h-6 items-center pb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-data">
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
  selectedVideoSource,
  mainViewMode = '3d'
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
        <div className={SLIDER_ROW_CLASS_NAME}>
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
        <div className={SLIDER_ROW_CLASS_NAME}>
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

  const renderCameraContent = () => {
    if (!selectedVideoSource) {
      return null;
    }

    return <UsbCameraViewer sourceId={selectedVideoSource.sourceId} />;
  };

  const renderRobotContent = (className?: string) => (
    <YahboomDogzillaLiteViewer
      status={status}
      servoPositions={displayPositions}
      servoAngles={liveAngles}
      refreshToken={refreshToken}
      className={className}
    />
  );

  const renderRobotInset = () => (
    <div className="pointer-events-auto absolute right-4 top-4 z-10 h-[200px] w-[320px] max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-border-default bg-surface-primary shadow-lg">
      {renderRobotContent('h-full w-full overflow-hidden')}
    </div>
  );

  if (mainViewMode === 'fullscreenVideo' && selectedVideoSource) {
    return (
      <div
        ref={fullscreenRootRef}
        tabIndex={-1}
        className="fixed inset-0 z-50 overflow-hidden bg-surface-primary text-text-primary outline-none"
      >
        <div className="h-full w-full">
          {renderCameraContent()}
        </div>
        {renderRobotInset()}
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
    <div className="flex h-full min-h-[44rem] flex-col gap-4 overflow-hidden rounded-b-lg bg-surface-secondary/30 p-4 text-text-primary">
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          {renderStatusPanel()}
          {renderImuPanel()}
          {renderSpeedPanel()}
        </div>

        <div className="min-h-0">
          <div className="relative h-full min-h-[28rem] overflow-hidden rounded-xl border border-border-default bg-surface-primary/20">
            {mainViewMode === 'photo' && selectedVideoSource ? (
              <div className="h-full w-full">
                {renderCameraContent()}
              </div>
            ) : renderRobotContent()}
            {mainViewMode === '3d' && selectedVideoSource && (
              <div className="pointer-events-auto absolute right-4 top-4 z-10 h-[200px] w-[320px] max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-border-default bg-surface-primary shadow-lg">
                {renderCameraContent()}
              </div>
            )}
            {mainViewMode === 'photo' && selectedVideoSource && (
              renderRobotInset()
            )}
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
              <YahboomDogzillaLiteDesktopMovementPanel deviceSerial={device?.serialNumber ?? ''} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <YahboomDogzillaLiteDesktopActionPanel deviceSerial={device?.serialNumber ?? ''} />
        </div>
      </div>

      <div className="grid grid-flow-col auto-cols-[minmax(12rem,1fr)] gap-3 overflow-x-auto pb-1">
        {renderArmPanel()}
        {LEG_PANELS.map((panel) => (
          <div key={panel.legId}>
            {renderLegPanel(panel.title, panel.legId)}
          </div>
        ))}
      </div>
    </div>
  );
});

export default YahboomDogzillaLiteDesktopDashboard;
