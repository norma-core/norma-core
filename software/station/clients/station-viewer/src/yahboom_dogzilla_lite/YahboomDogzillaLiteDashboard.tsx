import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import {
  Activity,
  Gauge,
  Minus,
  Move3d,
  Plus,
  Radar,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import { commandManager } from '@/api/commands.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { yahboom_dogzilla_lite } from '@/api/proto.js';
import ActionPanel, { QUICK_ACTIONS, type ActionDefinition } from '@/yahboom_dogzilla_lite/ActionPanel';
import YahboomDogzillaLiteViewer from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewer';
import MovementPanel, { type MovementPanelRef } from '@/yahboom_dogzilla_lite/MovementPanel';
import { getYahboomDogzillaLiteModelLabel } from '@/yahboom_dogzilla_lite/model-labels';
import { useConnectionStatsWithUptime } from '@/hooks';

const DEFAULT_SERVO_POSITIONS = [
  128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110,
  0, 255, 0
];

const SERVO_IDS = [
  11, 12, 13,
  21, 22, 23,
  31, 32, 33,
  41, 42, 43,
  51, 52, 53
];

const ARM_SERVO_IDS = [53, 52, 51] as const;
const ARM_DEFAULT_POSITIONS = [DEFAULT_SERVO_POSITIONS[14], DEFAULT_SERVO_POSITIONS[13], DEFAULT_SERVO_POSITIONS[12]];
const LEG_STEP = 8;

const LEG_CONFIGS = [
  {
    key: 'FL',
    label: 'Front Left',
    servoIds: { shoulder: 13, arm: 12, elbow: 11 },
    mirrorKey: 'FR'
  },
  {
    key: 'FR',
    label: 'Front Right',
    servoIds: { shoulder: 23, arm: 22, elbow: 21 },
    mirrorKey: 'FL'
  },
  {
    key: 'RR',
    label: 'Rear Right',
    servoIds: { shoulder: 33, arm: 32, elbow: 31 },
    mirrorKey: 'RL'
  },
  {
    key: 'RL',
    label: 'Rear Left',
    servoIds: { shoulder: 43, arm: 42, elbow: 41 },
    mirrorKey: 'RR'
  }
] as const;

const LEG_CONTROL_KEYS = ['shoulder', 'arm', 'elbow'] as const;
const TAB_DEFINITIONS = [
  { id: 'move', label: 'Move', icon: Move3d },
  { id: 'actions', label: 'Actions', icon: Sparkles },
  { id: 'joints', label: 'Joints', icon: SlidersHorizontal },
  { id: 'status', label: 'Status', icon: Activity }
] as const;

const formatAcceleration = (value: number | null | undefined) => {
  const formattedValue = (value ?? 0).toFixed(1);
  return formattedValue === '-0.0' ? '0.0' : formattedValue;
};

type TabId = (typeof TAB_DEFINITIONS)[number]['id'];
type JointTabId = 'legs' | 'arm';
type LegKey = (typeof LEG_CONFIGS)[number]['key'];
type LegControlKey = (typeof LEG_CONTROL_KEYS)[number];

interface DashboardLogEntry {
  id: number;
  label: string;
  timestamp: number;
}

interface YahboomDogzillaLiteDashboardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState | null;
  refreshToken?: number;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function formatDuration(connectedAt: number | null) {
  if (!connectedAt) {
    return 'N/A';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(2)} ${units[exponent]}`;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp);
}

function getServoIndex(servoId: number) {
  return SERVO_IDS.indexOf(servoId);
}

function StatusPill({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'danger' }) {
  const toneClass = {
    default: 'border-border-default bg-surface-primary/85 text-text-primary',
    good: 'border-accent-success-deep bg-surface-primary/90 text-accent-success',
    warn: 'border-accent-warning-deep bg-surface-primary/90 text-accent-warning',
    danger: 'border-accent-critical-deep bg-surface-primary/90 text-accent-critical'
  }[tone];

  return (
    <div className={`rounded-md border px-2.5 py-2 ${toneClass}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function TabButton({
  label,
  icon: Icon,
  isActive,
  onClick
}: {
  label: string;
  icon: typeof Move3d;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 min-w-[5.1rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition ${
        isActive
          ? 'border-accent-data bg-accent-data/10 text-accent-data'
          : 'border-border-default bg-surface-primary/80 text-text-secondary hover:border-accent-data hover:text-accent-data'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function QuickActionButton({
  label,
  isDanger,
  onClick
}: {
  label: string;
  isDanger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        isDanger
          ? 'border-accent-critical-deep bg-accent-critical/10 text-accent-critical hover:border-accent-critical hover:bg-accent-critical/20'
          : 'border-border-default bg-surface-primary/80 text-text-primary hover:border-accent-data hover:text-accent-data'
      }`}
    >
      {label}
    </button>
  );
}

function SliderControlCard({
  label,
  value,
  angle,
  step,
  onAdjust,
  onChange
}: {
  label: string;
  value: number;
  angle?: number;
  step: number;
  onAdjust: (delta: number) => void;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
          <div className="mt-1 font-mono text-lg font-semibold text-text-primary">{value}</div>
        </div>
        <div className="text-right text-xs text-text-muted">
          <div>Position</div>
          <div className="mt-1 font-mono text-accent-data">{angle === undefined ? '—' : `${Math.round(angle)}°`}</div>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="control-slider mt-4 h-4 w-full"
      />
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onAdjust(-step)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-border-default bg-surface-base text-text-primary transition hover:border-accent-data hover:text-accent-data"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="flex-1 rounded-md border border-border-default bg-surface-base px-4 py-2 text-center font-mono text-sm font-medium text-text-secondary">
          Step {step}
        </div>
        <button
          type="button"
          onClick={() => onAdjust(step)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-border-default bg-surface-base text-text-primary transition hover:border-accent-data hover:text-accent-data"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StatusSection({
  title,
  icon: Icon,
  rows
}: {
  title: string;
  icon: typeof Radar;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent-data" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-accent-data">{title}</h3>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md border border-border-default bg-surface-base px-3 py-3 text-sm">
            <div className="text-text-muted">{row.label}</div>
            <div className="mt-1 text-right font-mono font-medium text-text-primary">{row.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const YahboomDogzillaLiteDashboard = memo(function YahboomDogzillaLiteDashboard({
  deviceState,
  refreshToken
}: YahboomDogzillaLiteDashboardProps) {
  const movementPanelRef = useRef<MovementPanelRef | null>(null);
  const latencyHistoryRef = useRef<Array<{ timestamp: number; latency: number }>>([]);
  const logIdRef = useRef(0);

  const [activeTab, setActiveTab] = useState<TabId>('move');
  const [jointTab, setJointTab] = useState<JointTabId>('legs');
  const [selectedLeg, setSelectedLeg] = useState<LegKey>('FL');
  const [mirrorLegs, setMirrorLegs] = useState(false);
  const [armStepMode, setArmStepMode] = useState<'coarse' | 'fine'>('coarse');
  const [legsSpeed, setLegsSpeed] = useState(128);
  const [armSpeed, setArmSpeed] = useState(128);
  const [activeAction, setActiveAction] = useState<yahboom_dogzilla_lite.ActionType | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState('Ready');
  const [commandLog, setCommandLog] = useState<DashboardLogEntry[]>([]);

  const connectionStats = useConnectionStatsWithUptime();

  const status = deviceState?.status ?? null;
  const device = deviceState?.device ?? null;
  const isConnected = deviceState?.isConnected ?? false;

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

  const displayPositions = livePositions ?? DEFAULT_SERVO_POSITIONS;

  useEffect(() => {
    if (status?.legServoSpeed !== null && status?.legServoSpeed !== undefined) {
      setLegsSpeed(status.legServoSpeed);
    }
    if (status?.armServoSpeed !== null && status?.armServoSpeed !== undefined) {
      setArmSpeed(status.armServoSpeed);
    }
  }, [status?.armServoSpeed, status?.legServoSpeed]);

  const now = Date.now();
  const frameTimestamp = deviceState?.monotonicStampNs
    ? serverToLocal(Long.fromValue(deviceState.monotonicStampNs)).toNumber() / 1e6
    : null;
  const deviceLatency = frameTimestamp ? Math.max(0, now - frameTimestamp) : 0;

  latencyHistoryRef.current.push({ timestamp: now, latency: deviceLatency });
  latencyHistoryRef.current = latencyHistoryRef.current.filter((entry) => now - entry.timestamp <= 15000);

  const latencySamples = latencyHistoryRef.current.length > 0
    ? latencyHistoryRef.current
    : [{ timestamp: now, latency: deviceLatency }];
  const averageLatency = latencySamples.reduce((sum, entry) => sum + entry.latency, 0) / latencySamples.length;
  const pingValue = connectionStats?.timeSync?.isActive ? connectionStats.timeSync.pingMs : averageLatency;
  const pingTone = !isConnected ? 'danger' : pingValue < 100 ? 'good' : pingValue < 300 ? 'warn' : 'danger';

  const batteryPercent = status?.batteryLevel ?? null;
  const batteryLabel = batteryPercent === null ? '—' : `${Math.min(100, Math.max(0, batteryPercent))}%`;
  const batteryTone = batteryPercent === null ? 'default' : batteryPercent < 20 ? 'danger' : batteryPercent < 50 ? 'warn' : 'good';

  const connectionLabel = isConnected ? 'Online' : 'Offline';
  const connectionTone = isConnected ? 'good' : 'danger';

  const selectedLegConfig = LEG_CONFIGS.find((leg) => leg.key === selectedLeg) ?? LEG_CONFIGS[0];
  const selectedLegValues = LEG_CONTROL_KEYS.map((controlKey) => {
    const servoId = selectedLegConfig.servoIds[controlKey];
    const index = getServoIndex(servoId);
    return {
      controlKey,
      label: controlKey.charAt(0).toUpperCase() + controlKey.slice(1),
      servoId,
      index,
      value: displayPositions[index] ?? 128,
      angle: liveAngles?.[index]
    };
  });

  const armControls = ARM_SERVO_IDS.map((servoId, index) => {
    const servoIndex = getServoIndex(servoId);
    const labels = ['Shoulder', 'Elbow', 'Gripper'];
    return {
      label: labels[index],
      servoId,
      index: servoIndex,
      value: displayPositions[servoIndex] ?? ARM_DEFAULT_POSITIONS[index],
      angle: liveAngles?.[servoIndex]
    };
  });

  const pushLog = (label: string) => {
    logIdRef.current += 1;
    setCommandLog((current) => [
      { id: logIdRef.current, label, timestamp: Date.now() },
      ...current
    ].slice(0, 8));
  };

  const sendServoCommand = (servoId: number, position: number) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servo: {
        servoId,
        position: clampByte(position)
      }
    });
  };

  const sendAction = (action: ActionDefinition) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      action: { action: action.value }
    });
    setActiveAction(action.value);
    setLastActionLabel(action.label);
    pushLog(`Action: ${action.label}`);
  };

  const commitLegsSpeedChange = () => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { bodyServoSpeed: legsSpeed }
    });
    pushLog(`Leg speed: ${legsSpeed}`);
  };

  const commitArmSpeedChange = () => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { armServoSpeed: armSpeed }
    });
    pushLog(`Arm speed: ${armSpeed}`);
  };

  const handleEmergencyStop = () => {
    movementPanelRef.current?.stopAll();
    setActiveAction(null);
    setLastActionLabel('Emergency Stop');
    pushLog('Emergency stop');
  };

  const updateLegServo = (controlKey: LegControlKey, nextValue: number) => {
    const value = clampByte(nextValue);
    sendServoCommand(selectedLegConfig.servoIds[controlKey], value);

    if (mirrorLegs) {
      const mirrorLeg = LEG_CONFIGS.find((leg) => leg.key === selectedLegConfig.mirrorKey);
      if (mirrorLeg) {
        sendServoCommand(mirrorLeg.servoIds[controlKey], value);
      }
    }
  };

  const applySelectedLegToAll = () => {
    selectedLegValues.forEach(({ controlKey, value }) => {
      LEG_CONFIGS.forEach((leg) => {
        sendServoCommand(leg.servoIds[controlKey], value);
      });
    });
    pushLog(`Apply ${selectedLeg} to all legs`);
  };

  const armStep = armStepMode === 'coarse' ? 12 : 4;

  const updateArmServo = (servoId: number, value: number) => {
    sendServoCommand(servoId, value);
  };

  const applyArmNeutralPreset = () => {
    ARM_SERVO_IDS.forEach((servoId, index) => {
      sendServoCommand(servoId, ARM_DEFAULT_POSITIONS[index]);
    });
    setLastActionLabel('Arm Neutral');
    pushLog('Arm neutral preset');
  };

  const deviceRows = [
    { label: 'Model', value: modelLabel },
    { label: 'Firmware', value: device?.firmwareVersion || status?.firmwareVersion || '—' },
    { label: 'Battery', value: batteryLabel },
    { label: 'Connection', value: connectionLabel }
  ];

  const imuRows = [
    { label: 'Roll', value: `${Math.round(status?.orientation?.roll ?? 0)}°` },
    { label: 'Pitch', value: `${Math.round(status?.orientation?.pitch ?? 0)}°` },
    { label: 'Yaw', value: `${Math.round(status?.orientation?.yaw ?? 0)}°` },
    { label: 'Accel X', value: formatAcceleration(status?.acceleration?.x) },
    { label: 'Accel Y', value: formatAcceleration(status?.acceleration?.y) },
    { label: 'Accel Z', value: formatAcceleration(status?.acceleration?.z) }
  ];

  const networkRows = [
    { label: 'Endpoint', value: connectionStats?.endpoint ?? 'N/A' },
    { label: 'Packets', value: connectionStats ? connectionStats.packetsReceived.toLocaleString() : 'N/A' },
    { label: 'Data', value: connectionStats ? formatBytes(connectionStats.bytesReceived) : 'N/A' },
    { label: 'Uptime', value: formatDuration(connectionStats?.connectedAt ?? null) },
    { label: 'Latency', value: `${Math.round(averageLatency)} ms` }
  ];

  const renderMoveTab = () => (
    <MovementPanel
      ref={movementPanelRef}
      deviceSerial={device?.serialNumber ?? ''}
      legsSpeed={legsSpeed}
      armSpeed={armSpeed}
      onLegsSpeedChange={setLegsSpeed}
      onLegsSpeedCommit={commitLegsSpeedChange}
      onArmSpeedChange={setArmSpeed}
      onArmSpeedCommit={commitArmSpeedChange}
    />
  );

  const renderActionsTab = () => (
    <ActionPanel activeAction={activeAction} onActionSelect={sendAction} />
  );

  const renderJointsTab = () => (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg border border-border-default bg-surface-primary/80 p-2">
        <button
          type="button"
          onClick={() => setJointTab('legs')}
          className={`flex-1 rounded-md px-4 py-3 text-sm font-semibold transition ${
            jointTab === 'legs'
              ? 'border border-accent-data bg-accent-data/10 text-accent-data'
              : 'text-text-secondary hover:bg-surface-base hover:text-accent-data'
          }`}
        >
          Legs
        </button>
        <button
          type="button"
          onClick={() => setJointTab('arm')}
          className={`flex-1 rounded-md px-4 py-3 text-sm font-semibold transition ${
            jointTab === 'arm'
              ? 'border border-accent-data bg-accent-data/10 text-accent-data'
              : 'text-text-secondary hover:bg-surface-base hover:text-accent-data'
          }`}
        >
          Arm
        </button>
      </div>

      {jointTab === 'legs' ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            {LEG_CONFIGS.map((leg) => (
              <button
                key={leg.key}
                type="button"
                onClick={() => setSelectedLeg(leg.key)}
                className={`rounded-md border px-3 py-3 text-sm font-semibold transition ${
                  selectedLeg === leg.key
                    ? 'border-accent-data bg-accent-data/10 text-accent-data'
                    : 'border-border-default bg-surface-primary/80 text-text-secondary hover:border-accent-data hover:text-accent-data'
                }`}
              >
                {leg.key}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{selectedLeg}</div>
                <div className="mt-1 text-lg font-semibold text-text-primary">{selectedLegConfig.label}</div>
              </div>
              <button
                type="button"
                onClick={applySelectedLegToAll}
                className="rounded-md border border-border-default bg-surface-base px-4 py-3 text-sm font-semibold text-text-primary transition hover:border-accent-data hover:text-accent-data"
              >
                Apply to all
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-md border border-border-default bg-surface-base px-4 py-3">
              <label className="flex items-center gap-3 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={mirrorLegs}
                  onChange={(event) => setMirrorLegs(event.target.checked)}
                  className="h-5 w-5 rounded border-border-subtle bg-surface-base accent-accent-data"
                />
                Mirror
              </label>
              <div className="text-right text-sm text-text-muted">
                {mirrorLegs ? 'Selected leg + opposite side' : 'Selected leg only'}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {selectedLegValues.map((control) => (
              <SliderControlCard
                key={control.servoId}
                label={control.label}
                value={control.value}
                angle={control.angle}
                step={LEG_STEP}
                onChange={(value) => updateLegServo(control.controlKey, value)}
                onAdjust={(delta) => updateLegServo(control.controlKey, control.value + delta)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Adjustment</div>
              <div className="mt-1 text-sm text-text-primary">{armStepMode === 'coarse' ? 'Coarse' : 'Fine'} mode</div>
            </div>
            <button
              type="button"
              onClick={() => setArmStepMode((current) => (current === 'coarse' ? 'fine' : 'coarse'))}
              className="rounded-md border border-border-default bg-surface-base px-4 py-2 text-sm font-semibold text-text-primary transition hover:border-accent-data hover:text-accent-data"
            >
              {armStepMode === 'coarse' ? 'Fine' : 'Coarse'}
            </button>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {armControls.map((control) => (
              <SliderControlCard
                key={control.servoId}
                label={control.label}
                value={control.value}
                angle={control.angle}
                step={armStep}
                onChange={(value) => updateArmServo(control.servoId, value)}
                onAdjust={(delta) => updateArmServo(control.servoId, control.value + delta)}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={applyArmNeutralPreset}
              className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-border-default bg-surface-primary/80 px-4 py-3 text-sm font-semibold text-text-primary transition hover:border-accent-data hover:text-accent-data"
            >
              <RotateCcw className="h-4 w-4" />
              Neutral preset
            </button>
            <button
              type="button"
              onClick={() => sendAction(QUICK_ACTIONS[3])}
              className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-accent-critical-deep bg-accent-critical/10 px-4 py-3 text-sm font-semibold text-accent-critical transition hover:border-accent-critical hover:bg-accent-critical/20"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderStatusTab = () => (
    <div className="space-y-4">
      <div className="grid gap-4 2xl:grid-cols-2">
        <StatusSection title="Device" icon={Gauge} rows={deviceRows} />
        <StatusSection title="IMU" icon={Radar} rows={imuRows} />
        <StatusSection title="Session / Network" icon={Activity} rows={networkRows} />
      </div>

      <section className="rounded-lg border border-border-default bg-surface-primary/80 px-4 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent-data" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-accent-data">History / Logs</h3>
        </div>
        <div className="mt-4 space-y-3">
          {commandLog.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-default bg-surface-base px-4 py-6 text-center text-sm text-text-muted">
              No control events yet.
            </div>
          ) : (
            commandLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-surface-base px-4 py-3 text-sm"
              >
                <span className="text-text-primary">{entry.label}</span>
                <span className="font-mono text-xs uppercase tracking-wide text-text-muted">{formatTimestamp(entry.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-default bg-surface-primary/50 text-text-primary">
      <div className="relative flex h-[calc(100svh-7rem)] min-h-[46rem] max-h-[900px] flex-col lg:grid lg:h-[min(84vh,58rem)] lg:min-h-[44rem] lg:max-h-none lg:grid-cols-[minmax(0,1.18fr)_minmax(24rem,0.92fr)]">
        <section className="relative basis-[40%] overflow-hidden border-b border-border-default lg:basis-auto lg:border-b-0 lg:border-r lg:border-border-default">
          <YahboomDogzillaLiteViewer
            status={status}
            servoPositions={displayPositions}
            servoAngles={liveAngles}
            refreshToken={refreshToken}
          />

          <div className="absolute inset-0 flex flex-col justify-between p-3 lg:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 max-w-[calc(100%-7.5rem)] rounded-md border border-border-default bg-surface-primary/85 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Robot</div>
                <div className="mt-1 truncate font-mono text-sm font-semibold text-text-primary">
                  {device?.serialNumber ? `YahboomDogzillaLite #${device.serialNumber}` : 'YahboomDogzillaLite'} • <span className={connectionTone === 'good' ? 'text-accent-success' : 'text-accent-critical'}>{connectionLabel}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleEmergencyStop}
                className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-md border border-accent-critical-deep bg-accent-critical/20 px-3 py-2 text-sm font-semibold text-accent-critical transition hover:border-accent-critical hover:bg-accent-critical/20"
              >
                <ShieldAlert className="h-4 w-4" />
                E-Stop
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatusPill label="Battery" value={batteryLabel} tone={batteryTone} />
              <StatusPill label="Latency" value={`${Math.round(pingValue)} ms`} tone={pingTone} />
              <StatusPill label="Action" value={lastActionLabel} />
            </div>
          </div>
        </section>

        <section className="relative flex min-h-0 flex-1 flex-col bg-surface-primary/85 px-3 pb-3 pt-3 lg:px-4 lg:pb-4 lg:pt-4">
          <div className="-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2">
              {TAB_DEFINITIONS.map((tab) => (
                <TabButton
                  key={tab.id}
                  label={tab.label}
                  icon={tab.icon}
                  isActive={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
          </div>

          <div className="-mx-3 mt-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2">
              {QUICK_ACTIONS.map((action) => (
                <QuickActionButton
                  key={action.value}
                  label={action.label}
                  isDanger={action.value === yahboom_dogzilla_lite.ActionType.ACTION_RESTORE_DEFAULT}
                  onClick={() => sendAction(action)}
                />
              ))}
            </div>
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-1">
            {activeTab === 'move' && renderMoveTab()}
            {activeTab === 'actions' && renderActionsTab()}
            {activeTab === 'joints' && renderJointsTab()}
            {activeTab === 'status' && renderStatusTab()}
          </div>
        </section>
      </div>
    </div>
  );
});

export default YahboomDogzillaLiteDashboard;
