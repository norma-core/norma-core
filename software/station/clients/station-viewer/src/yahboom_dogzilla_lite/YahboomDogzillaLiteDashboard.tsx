import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  Gauge,
  Maximize2,
  Minimize2,
  Minus,
  Move3d,
  OctagonX,
  Plus,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import type { FrameEntry } from '@/api/frame-parser';
import { commandManager } from '@/api/commands.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { yahboom_dogzilla_lite, usbvideo } from '@/api/proto.js';
import ActionPanel, { QUICK_ACTIONS, type ActionDefinition } from '@/yahboom_dogzilla_lite/ActionPanel';
import AttitudeIndicator from '@/yahboom_dogzilla_lite/AttitudeIndicator';
import { CONTROL_SLIDER_CLASS_NAME } from '@/yahboom_dogzilla_lite/control-classes';
import YahboomDogzillaLiteViewer from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewer';
import MovementPanel, { type MovementPanelRef } from '@/yahboom_dogzilla_lite/MovementPanel';
import { getYahboomDogzillaLiteModelLabel } from '@/yahboom_dogzilla_lite/model-labels';
import { useConnectionStatsWithUptime } from '@/hooks';
import UsbCameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId, getVideoSourceLabel } from '@/usbvideo/camera-source';

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

const wrapDegrees = (value: number) => value - 360 * Math.floor((value + 180) / 360);

type TabId = (typeof TAB_DEFINITIONS)[number]['id'];
type JointTabId = 'legs' | 'arm';
type LegKey = (typeof LEG_CONFIGS)[number]['key'];
type LegControlKey = (typeof LEG_CONTROL_KEYS)[number];
type StageViewMode = '3d' | 'camera';

interface DashboardLogEntry {
  id: number;
  label: string;
  timestamp: number;
}

interface YahboomDogzillaLiteDashboardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState | null;
  refreshToken?: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
}

interface CameraOption {
  id: string;
  label: string;
  shortLabel: string;
  detail: string;
  entry: FrameEntry<usbvideo.IRxEnvelope>;
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

function exitFullscreen() {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

function StatusPill({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'danger' }) {
  const toneClass = {
    default: 'text-text-primary',
    good: 'text-accent-success',
    warn: 'text-accent-warning',
    danger: 'text-accent-critical'
  }[tone];

  return (
    <div className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:900px)_and_(orientation:portrait)]:text-[8px]">{label}</span>
      <span className={`min-w-0 truncate font-mono text-[13px] font-bold leading-none [@media(max-width:1023px)_and_(orientation:landscape)]:text-[12px] [@media(max-width:900px)_and_(orientation:portrait)]:text-[12px] ${toneClass}`} title={value}>
        {value}
      </span>
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
      className={`flex min-h-9 min-w-[5.1rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition group-data-[remote-fullscreen=true]/dashboard:min-h-[2.05rem] group-data-[remote-fullscreen=true]/dashboard:min-w-0 group-data-[remote-fullscreen=true]/dashboard:rounded-md group-data-[remote-fullscreen=true]/dashboard:px-2.5 group-data-[remote-fullscreen=true]/dashboard:py-1.5 group-data-[remote-fullscreen=true]/dashboard:text-[0.76rem] group-data-[remote-fullscreen=true]/dashboard:uppercase group-data-[remote-fullscreen=true]/dashboard:tracking-[0.08em] [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[1.9rem] [@media(max-width:1023px)_and_(orientation:landscape)]:min-w-0 [@media(max-width:1023px)_and_(orientation:landscape)]:rounded [@media(max-width:1023px)_and_(orientation:landscape)]:px-[0.5rem] [@media(max-width:1023px)_and_(orientation:landscape)]:py-[0.32rem] [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.68rem] [@media(max-width:1023px)_and_(orientation:landscape)]:uppercase [@media(max-width:1023px)_and_(orientation:landscape)]:tracking-[0.08em] ${
        isActive
          ? 'border-accent-data bg-accent-data/10 text-accent-data'
          : 'border-border-default bg-surface-primary/80 text-text-secondary hover:border-accent-data hover:text-accent-data'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="[@media(max-width:1023px)_and_(orientation:landscape)]:hidden">{label}</span>
    </button>
  );
}

function StageViewToggle({
  value,
  cameraDisabled,
  onChange
}: {
  value: StageViewMode;
  cameraDisabled: boolean;
  onChange: (value: StageViewMode) => void;
}) {
  const buttonClassName = (mode: StageViewMode) => (
    `m-0 flex h-8 w-10 shrink-0 appearance-none items-center justify-center rounded-md border p-0 text-[0.82rem] font-bold leading-none shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-data/70 disabled:cursor-not-allowed disabled:opacity-35 group-data-[remote-fullscreen=true]/dashboard:h-8 group-data-[remote-fullscreen=true]/dashboard:w-10 [@media(max-width:1023px)_and_(orientation:landscape)]:h-[1.75rem] [@media(max-width:1023px)_and_(orientation:landscape)]:w-[2.2rem] [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.72rem] ${
      value === mode
        ? 'border-accent-data bg-accent-data text-surface-base'
        : 'border-accent-data/35 bg-surface-primary/70 text-text-secondary hover:border-accent-data/70 hover:bg-surface-primary/85 hover:text-text-primary'
    }`
  );

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-md"
      role="group"
      aria-label="Stage view"
    >
      <button
        type="button"
        className={buttonClassName('3d')}
        onClick={() => onChange('3d')}
        aria-pressed={value === '3d'}
        title="3D"
      >
        3D
      </button>
      <button
        type="button"
        className={buttonClassName('camera')}
        disabled={cameraDisabled}
        onClick={() => onChange('camera')}
        aria-pressed={value === 'camera'}
        aria-label={cameraDisabled ? 'No camera' : 'Camera'}
        title={cameraDisabled ? 'No camera' : 'Camera'}
      >
        <Camera className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
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
      className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition group-data-[remote-fullscreen=true]/dashboard:min-h-[2.05rem] group-data-[remote-fullscreen=true]/dashboard:rounded-md group-data-[remote-fullscreen=true]/dashboard:bg-transparent group-data-[remote-fullscreen=true]/dashboard:px-3.5 group-data-[remote-fullscreen=true]/dashboard:py-1.5 group-data-[remote-fullscreen=true]/dashboard:text-[0.76rem] group-data-[remote-fullscreen=true]/dashboard:uppercase group-data-[remote-fullscreen=true]/dashboard:tracking-[0.08em] group-data-[remote-fullscreen=true]/dashboard:shadow-none group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-0 [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[1.9rem] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded [@media(max-width:1023px)_and_(orientation:landscape)]:bg-transparent [@media(max-width:1023px)_and_(orientation:landscape)]:px-[0.65rem] [@media(max-width:1023px)_and_(orientation:landscape)]:py-[0.32rem] [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.68rem] [@media(max-width:1023px)_and_(orientation:landscape)]:uppercase [@media(max-width:1023px)_and_(orientation:landscape)]:tracking-[0.08em] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-none [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-0 ${
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
        className={CONTROL_SLIDER_CLASS_NAME}
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
  refreshToken,
  videoSources
}: YahboomDogzillaLiteDashboardProps) {
  const dashboardRootRef = useRef<HTMLDivElement | null>(null);
  const movementPanelRef = useRef<MovementPanelRef | null>(null);
  const latencyHistoryRef = useRef<Array<{ timestamp: number; latency: number }>>([]);
  const logIdRef = useRef(0);

  const [activeTab, setActiveTab] = useState<TabId>('move');
  const [stageViewMode, setStageViewMode] = useState<StageViewMode>('3d');
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState('');
  const [isCameraPickerOpen, setIsCameraPickerOpen] = useState(false);
  const [jointTab, setJointTab] = useState<JointTabId>('legs');
  const [selectedLeg, setSelectedLeg] = useState<LegKey>('FL');
  const [mirrorLegs, setMirrorLegs] = useState(false);
  const [armStepMode, setArmStepMode] = useState<'coarse' | 'fine'>('coarse');
  const [legsSpeed, setLegsSpeed] = useState(128);
  const [armSpeed, setArmSpeed] = useState(128);
  const [isRemoteFullscreen, setIsRemoteFullscreen] = useState(false);
  const [activeAction, setActiveAction] = useState<yahboom_dogzilla_lite.ActionType | null>(null);
  const [commandLog, setCommandLog] = useState<DashboardLogEntry[]>([]);

  const connectionStats = useConnectionStatsWithUptime();

  const status = deviceState?.status ?? null;
  const device = deviceState?.device ?? null;
  const isConnected = deviceState?.isConnected ?? false;
  const usbVideoSources = useMemo(() => videoSources ?? [], [videoSources]);

  const cameraOptions = useMemo<CameraOption[]>(() => (
    usbVideoSources.map((entry) => {
      const id = getVideoSourceId(entry);
      const camera = entry.data.camera;
      const product = camera?.product?.trim();
      const deviceNumber = camera?.deviceNumber !== undefined ? `USB ${camera.deviceNumber}` : '';
      const uniqueId = camera?.uniqueId ?? '';
      const shortLabel = product || deviceNumber || 'Camera';

      return {
        id,
        label: getVideoSourceLabel(entry),
        shortLabel,
        detail: uniqueId || entry.queueId,
        entry
      };
    }).filter((option) => option.id.length > 0)
  ), [usbVideoSources]);

  const selectedVideoSource = useMemo(() => {
    const option = cameraOptions.find((cameraOption) => cameraOption.id === selectedVideoSourceId);
    return option
      ? {
        kind: 'usbvideo' as const,
        source: option.entry.data,
        sourceId: option.id,
        label: option.label,
        shortLabel: option.shortLabel,
        detail: option.detail
      }
      : undefined;
  }, [cameraOptions, selectedVideoSourceId]);

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

  useEffect(() => {
    if (cameraOptions.some((option) => option.id === selectedVideoSourceId)) {
      return;
    }

    setSelectedVideoSourceId(cameraOptions[0]?.id ?? '');
  }, [cameraOptions, selectedVideoSourceId]);

  useEffect(() => {
    if (cameraOptions.length <= 1) {
      setIsCameraPickerOpen(false);
    }
  }, [cameraOptions.length]);

  useEffect(() => {
    if (!selectedVideoSource && stageViewMode !== '3d') {
      exitFullscreen();
      setStageViewMode('3d');
    }
  }, [selectedVideoSource, stageViewMode]);

  useEffect(() => {
    if (!isRemoteFullscreen) {
      return undefined;
    }

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
      if (document.fullscreenElement) {
        return;
      }

      if (isRemoteFullscreen) {
        setIsRemoteFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isRemoteFullscreen]);

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
  const robotSerial = device?.serialNumber ?? null;
  const robotDisplayName = robotSerial ? `Dogzilla #${robotSerial}` : 'Dogzilla Lite';
  const robotShortId = robotSerial ? `#${robotSerial.slice(-6)}` : 'Lite';
  const hasMultipleCameraOptions = cameraOptions.length > 1;

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
    pushLog('Emergency stop');
  };

  const handleStageViewModeChange = (nextMode: StageViewMode) => {
    if (nextMode !== '3d' && !selectedVideoSource) {
      return;
    }

    setIsCameraPickerOpen(false);
    setStageViewMode(nextMode);
  };

  const handleRemoteFullscreenToggle = () => {
    if (isRemoteFullscreen) {
      setIsRemoteFullscreen(false);
      if (document.fullscreenElement === dashboardRootRef.current) {
        exitFullscreen();
      }
      return;
    }

    setActiveTab('move');
    setIsRemoteFullscreen(true);
    const root = dashboardRootRef.current;
    if (root && !document.fullscreenElement && root.requestFullscreen) {
      void root.requestFullscreen().catch(() => undefined);
    }
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
    pushLog('Arm neutral preset');
  };

  const deviceRows = [
    { label: 'Model', value: modelLabel },
    { label: 'Firmware', value: device?.firmwareVersion || status?.firmwareVersion || '—' },
    { label: 'Battery', value: batteryLabel },
    { label: 'Connection', value: connectionLabel }
  ];

  const imuRows = [
    { label: 'Roll', value: `${Math.round(wrapDegrees(status?.orientation?.roll ?? 0))}°` },
    { label: 'Pitch', value: `${Math.round(wrapDegrees(status?.orientation?.pitch ?? 0))}°` },
    { label: 'Yaw', value: `${Math.round(wrapDegrees(status?.orientation?.yaw ?? 0))}°` },
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

  const renderRobotContent = (className = 'h-full min-h-0 w-full overflow-hidden') => (
    <YahboomDogzillaLiteViewer
      status={status}
      servoPositions={displayPositions}
      servoAngles={liveAngles}
      refreshToken={refreshToken}
      className={className}
      fullscreenFraming={isRemoteFullscreen}
    />
  );

  const renderCameraContent = (fit: 'contain' | 'cover' = 'cover') => (
    <UsbCameraViewer
      sourceId={selectedVideoSource?.sourceId}
      className="h-full w-full"
      overlay="none"
      fit={fit}
    />
  );
  const isCameraStageActive = stageViewMode === 'camera' && Boolean(selectedVideoSource);
  const stageViewControls = (
    <div className={`pointer-events-auto flex h-fit min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-transparent p-0 [@media(max-width:900px)_and_(orientation:portrait)]:gap-1 ${
      isCameraStageActive ? 'max-w-[calc(100vw-11rem)]' : 'max-w-full'
    }`}
    >
      <StageViewToggle
        value={stageViewMode}
        cameraDisabled={!selectedVideoSource}
        onChange={handleStageViewModeChange}
      />
      {hasMultipleCameraOptions && (
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setIsCameraPickerOpen((current) => !current)}
            className={`flex h-8 w-[8.5rem] min-w-0 items-center justify-between gap-1.5 rounded-md border px-2 text-left text-[11px] font-semibold transition focus:outline-none focus:ring-1 focus:ring-accent-data [@media(max-width:1023px)_and_(orientation:landscape)]:h-[1.75rem] [@media(max-width:1023px)_and_(orientation:landscape)]:max-h-[1.75rem] [@media(max-width:1023px)_and_(orientation:landscape)]:w-[7.25rem] ${
              isCameraPickerOpen
                ? 'border-accent-data bg-surface-primary text-text-primary'
                : 'border-border-subtle bg-surface-primary/70 text-text-primary hover:border-accent-data'
            }`}
            aria-haspopup="listbox"
            aria-expanded={isCameraPickerOpen}
            aria-label="Camera source"
            title={selectedVideoSource?.label ?? 'No camera'}
          >
            <span className="min-w-0 truncate">
              {selectedVideoSource?.shortLabel ?? 'No camera'}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isCameraPickerOpen ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
            />
          </button>

          {isCameraPickerOpen && (
            <div
              className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-surface-primary/95 p-1.5 shadow-2xl backdrop-blur-md"
              role="listbox"
              aria-label="Camera source"
            >
              <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">
                Camera source
              </div>
              <div className="max-h-56 overflow-y-auto">
                {cameraOptions.map((option) => {
                  const isSelected = option.id === selectedVideoSourceId;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setSelectedVideoSourceId(option.id);
                        setIsCameraPickerOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition ${
                        isSelected
                          ? 'bg-accent-data text-surface-base'
                          : 'text-text-primary hover:bg-surface-secondary'
                      }`}
                      role="option"
                      aria-selected={isSelected}
                      title={option.label}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-surface-base/70 bg-surface-base/18'
                          : 'border-border-subtle text-transparent'
                      }`}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {option.shortLabel}
                        </span>
                        <span className={`block truncate text-[11px] font-medium ${
                          isSelected ? 'text-surface-base/72' : 'text-text-muted'
                        }`}
                        >
                          {option.detail}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={dashboardRootRef}
      data-remote-fullscreen={isRemoteFullscreen ? 'true' : undefined}
      className="group/dashboard relative -mx-1 overflow-hidden border-y border-border-default bg-surface-primary/50 text-text-primary data-[remote-fullscreen=true]:!fixed data-[remote-fullscreen=true]:!inset-0 data-[remote-fullscreen=true]:!z-[60] data-[remote-fullscreen=true]:!m-0 data-[remote-fullscreen=true]:!h-[100svh] data-[remote-fullscreen=true]:!w-screen data-[remote-fullscreen=true]:!rounded-none data-[remote-fullscreen=true]:!border-0 data-[remote-fullscreen=true]:!bg-surface-base sm:mx-0 sm:rounded-lg sm:border [@media(max-width:1023px)_and_(orientation:landscape)]:mx-0 [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-xl [&:fullscreen]:!fixed [&:fullscreen]:!inset-0 [&:fullscreen]:!z-[60] [&:fullscreen]:!m-0 [&:fullscreen]:!h-[100svh] [&:fullscreen]:!w-screen [&:fullscreen]:!rounded-none [&:fullscreen]:!border-0 [&:fullscreen]:!bg-surface-base"
    >
      <div
        data-active-tab={activeTab}
        className="relative flex h-[calc(100svh-7rem)] min-h-[46rem] max-h-[900px] flex-col group-data-[remote-fullscreen=true]/dashboard:!block group-data-[remote-fullscreen=true]/dashboard:!h-[100svh] group-data-[remote-fullscreen=true]/dashboard:!min-h-[100svh] group-data-[remote-fullscreen=true]/dashboard:!max-h-none group-data-[remote-fullscreen=true]/dashboard:!overflow-hidden lg:grid lg:h-[min(84vh,58rem)] lg:min-h-[44rem] lg:max-h-none lg:grid-cols-[minmax(0,1.18fr)_minmax(24rem,0.92fr)] [@media(max-width:1023px)_and_(orientation:landscape)]:block [@media(max-width:1023px)_and_(orientation:landscape)]:h-[clamp(18rem,calc(100svh-8.5rem),35rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[18rem] [@media(max-width:1023px)_and_(orientation:landscape)]:max-h-none [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-hidden [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[clamp(18rem,calc(100svh-8.5rem),22rem)]"
      >
        <section className="relative basis-[43%] overflow-hidden border-b border-border-default bg-surface-base group-data-[remote-fullscreen=true]/dashboard:!absolute group-data-[remote-fullscreen=true]/dashboard:!inset-0 group-data-[remote-fullscreen=true]/dashboard:!min-h-0 group-data-[remote-fullscreen=true]/dashboard:!border-0 lg:basis-auto lg:border-b-0 lg:border-r lg:border-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0 [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-0 [@media(max-width:1023px)_and_(orientation:landscape)]:border-0">
          <div className="absolute inset-0">
            {isCameraStageActive ? renderCameraContent('cover') : renderRobotContent()}
          </div>

          <div className="pointer-events-none absolute inset-0">
            <div
              className="pointer-events-none absolute inset-0 z-[5] hidden [background:radial-gradient(circle_at_18%_82%,rgba(34,211,238,0.14),transparent_27%),radial-gradient(circle_at_84%_78%,rgba(34,211,238,0.10),transparent_24%),linear-gradient(90deg,rgba(0,0,0,0.30),transparent_32%,transparent_68%,rgba(0,0,0,0.30)),linear-gradient(180deg,rgba(0,0,0,0.18),transparent_34%,rgba(0,0,0,0.22))] [@media(max-width:1023px)_and_(orientation:landscape)]:block"
              aria-hidden="true"
            />
            <span className="pointer-events-none absolute left-[0.55rem] top-[0.55rem] z-[6] hidden h-[0.95rem] w-[0.95rem] border-l-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute right-[0.55rem] top-[0.55rem] z-[6] hidden h-[0.95rem] w-[0.95rem] border-r-2 border-t-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute bottom-[0.55rem] left-[0.55rem] z-[6] hidden h-[0.95rem] w-[0.95rem] border-b-2 border-l-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
            <span className="pointer-events-none absolute bottom-[0.55rem] right-[0.55rem] z-[6] hidden h-[0.95rem] w-[0.95rem] border-b-2 border-r-2 border-accent-data/70 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />

            <div className="absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:inset-x-[0.85rem] [@media(max-width:1023px)_and_(orientation:landscape)]:top-3 [@media(max-width:900px)_and_(orientation:portrait)]:top-3">
              <div className="flex min-w-0 max-w-[calc(100%-6.5rem)] items-center gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[calc(100%-6rem)] [@media(max-width:1023px)_and_(orientation:landscape)]:gap-1.5 [@media(max-width:900px)_and_(orientation:portrait)]:max-w-[calc(100%-6.25rem)] [@media(max-width:900px)_and_(orientation:portrait)]:flex-col [@media(max-width:900px)_and_(orientation:portrait)]:items-start [@media(max-width:900px)_and_(orientation:portrait)]:gap-1.5">
                <div className="pointer-events-auto flex min-h-10 min-w-0 max-w-[min(26rem,calc(100vw-12rem))] shrink items-center gap-3 rounded-md border border-accent-data/35 bg-surface-primary/30 px-3 py-2 backdrop-blur-[2px] group-data-[remote-fullscreen=true]/dashboard:max-w-[26rem] group-data-[remote-fullscreen=true]/dashboard:gap-3.5 [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[2.35rem] [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[min(22rem,calc(100vw-12rem))] [@media(max-width:1023px)_and_(orientation:landscape)]:gap-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/40 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/55 [@media(max-width:1023px)_and_(orientation:landscape)]:px-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:py-[0.35rem] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:900px)_and_(orientation:portrait)]:min-h-0 [@media(max-width:900px)_and_(orientation:portrait)]:w-[min(13rem,calc(100vw-7rem))] [@media(max-width:900px)_and_(orientation:portrait)]:max-w-[min(13rem,calc(100vw-7rem))] [@media(max-width:900px)_and_(orientation:portrait)]:flex-col [@media(max-width:900px)_and_(orientation:portrait)]:items-stretch [@media(max-width:900px)_and_(orientation:portrait)]:gap-1.5 [@media(max-width:900px)_and_(orientation:portrait)]:bg-surface-primary/65 [@media(max-width:900px)_and_(orientation:portrait)]:px-2.5 [@media(max-width:900px)_and_(orientation:portrait)]:py-2 [@media(max-width:900px)_and_(orientation:portrait)]:shadow-[0_0.55rem_1.35rem_rgba(0,0,0,0.14)] [@media(max-width:900px)_and_(orientation:portrait)]:backdrop-blur-md">
                  <div className="flex min-w-0 items-center gap-2 [@media(max-width:900px)_and_(orientation:portrait)]:w-full">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${connectionTone === 'good' ? 'bg-accent-success' : 'bg-accent-critical'}`} />
                    <span className="shrink-0 font-mono text-[12px] font-bold uppercase leading-none tracking-[0.14em] text-text-primary [@media(max-width:1023px)_and_(orientation:landscape)]:text-[11px]" title={robotDisplayName}>
                      Dogzilla
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11px] font-bold uppercase leading-none tracking-[0.12em] text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[5.5rem] [@media(max-width:900px)_and_(orientation:portrait)]:ml-auto [@media(max-width:900px)_and_(orientation:portrait)]:max-w-[4.6rem] [@media(max-width:900px)_and_(orientation:portrait)]:text-[10px]" title={robotDisplayName}>
                      {robotShortId}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 [@media(max-width:1023px)_and_(orientation:landscape)]:gap-2.5 [@media(max-width:900px)_and_(orientation:portrait)]:w-full [@media(max-width:900px)_and_(orientation:portrait)]:justify-between [@media(max-width:900px)_and_(orientation:portrait)]:gap-2">
                    <StatusPill label="Bat" value={batteryLabel} tone={batteryTone} />
                    <StatusPill label="Ping" value={`${Math.round(pingValue)} ms`} tone={pingTone} />
                  </div>
                </div>
                {stageViewControls}
              </div>
              <div className="pointer-events-auto flex shrink-0 items-start gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:gap-[0.45rem]">
                <button
                  type="button"
                  onClick={handleRemoteFullscreenToggle}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-primary/35 text-text-secondary shadow-sm backdrop-blur-sm transition hover:border-accent-data hover:bg-accent-data/12 hover:text-accent-data focus:outline-none focus:ring-2 focus:ring-accent-data/70 focus:ring-offset-2 focus:ring-offset-surface-primary [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/35 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/50 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md"
                  aria-label={isRemoteFullscreen ? 'Exit remote fullscreen' : 'Open remote fullscreen'}
                  aria-pressed={isRemoteFullscreen}
                  title={isRemoteFullscreen ? 'Exit remote fullscreen' : 'Open remote fullscreen'}
                >
                  {isRemoteFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleEmergencyStop}
                  className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-accent-critical-deep bg-accent-critical/14 text-accent-critical shadow-sm backdrop-blur-sm transition hover:border-accent-critical hover:bg-accent-critical/22 focus:outline-none focus:ring-2 focus:ring-accent-critical-deep focus:ring-offset-2 focus:ring-offset-surface-primary [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-critical/55 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-accent-critical/20 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md"
                  aria-label="Emergency stop"
                  title="Emergency stop"
                >
                  <OctagonX className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className={`pointer-events-none absolute right-3 top-[4.5rem] z-20 hidden flex-col items-end gap-2 group-data-[remote-fullscreen=true]/dashboard:!right-7 group-data-[remote-fullscreen=true]/dashboard:!top-[7.4rem] [@media(max-width:1023px)_and_(orientation:landscape)]:right-[0.85rem] [@media(max-width:1023px)_and_(orientation:landscape)]:top-[4.4rem] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!hidden ${
              activeTab === 'move'
                ? 'group-data-[remote-fullscreen=true]/dashboard:flex [@media(max-width:1023px)_and_(orientation:landscape)]:flex'
                : ''
            }`}
            >
              <AttitudeIndicator
                roll={wrapDegrees(status?.orientation?.roll ?? 0)}
                pitch={wrapDegrees(status?.orientation?.pitch ?? 0)}
              />
            </div>
          </div>
        </section>

        <section
          data-active-tab={activeTab}
          className="relative flex min-h-0 flex-1 flex-col bg-surface-primary/90 px-2.5 pb-2.5 pt-2.5 group-data-[remote-fullscreen=true]/dashboard:!pointer-events-none group-data-[remote-fullscreen=true]/dashboard:!absolute group-data-[remote-fullscreen=true]/dashboard:!inset-0 group-data-[remote-fullscreen=true]/dashboard:!z-[30] group-data-[remote-fullscreen=true]/dashboard:!overflow-hidden group-data-[remote-fullscreen=true]/dashboard:!bg-transparent group-data-[remote-fullscreen=true]/dashboard:!p-0 lg:px-4 lg:pb-4 lg:pt-4 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0 [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-hidden [@media(max-width:1023px)_and_(orientation:landscape)]:bg-transparent [@media(max-width:1023px)_and_(orientation:landscape)]:p-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pointer-events-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!inset-x-3 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!bottom-3 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!top-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!z-[35] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!max-h-[48svh] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!overflow-hidden [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!rounded-xl [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!border [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!border-accent-data/30 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!bg-surface-primary/68 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!p-2 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!shadow-[0_1rem_2.5rem_rgba(0,0,0,0.22)] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!backdrop-blur-md"
        >
          <div className="group-data-[remote-fullscreen=true]/dashboard:pointer-events-auto group-data-[remote-fullscreen=true]/dashboard:absolute group-data-[remote-fullscreen=true]/dashboard:!bottom-4 group-data-[remote-fullscreen=true]/dashboard:!left-1/2 group-data-[remote-fullscreen=true]/dashboard:z-[45] group-data-[remote-fullscreen=true]/dashboard:inline-flex group-data-[remote-fullscreen=true]/dashboard:!max-w-[92vw] group-data-[remote-fullscreen=true]/dashboard:-translate-x-1/2 group-data-[remote-fullscreen=true]/dashboard:items-stretch group-data-[remote-fullscreen=true]/dashboard:!gap-1.5 group-data-[remote-fullscreen=true]/dashboard:rounded-lg group-data-[remote-fullscreen=true]/dashboard:border group-data-[remote-fullscreen=true]/dashboard:border-accent-data/30 group-data-[remote-fullscreen=true]/dashboard:bg-surface-primary/62 group-data-[remote-fullscreen=true]/dashboard:!p-1.5 group-data-[remote-fullscreen=true]/dashboard:shadow-[0_0.9rem_2rem_rgba(0,0,0,0.20)] group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:bottom-[0.6rem] [@media(max-width:1023px)_and_(orientation:landscape)]:left-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:z-[35] [@media(max-width:1023px)_and_(orientation:landscape)]:inline-flex [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-[92vw] [@media(max-width:1023px)_and_(orientation:landscape)]:-translate-x-1/2 [@media(max-width:1023px)_and_(orientation:landscape)]:items-stretch [@media(max-width:1023px)_and_(orientation:landscape)]:gap-[0.35rem] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-md [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/55 [@media(max-width:1023px)_and_(orientation:landscape)]:p-[0.22rem] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.9rem_2rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!relative [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!bottom-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!left-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!block [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!w-full [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!max-w-full [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!translate-x-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!rounded-none [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!border-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!bg-transparent [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!p-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!shadow-none [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!backdrop-blur-0">
            <div className="-mx-2.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none] group-data-[remote-fullscreen=true]/dashboard:relative group-data-[remote-fullscreen=true]/dashboard:z-auto group-data-[remote-fullscreen=true]/dashboard:m-0 group-data-[remote-fullscreen=true]/dashboard:w-auto group-data-[remote-fullscreen=true]/dashboard:max-w-none group-data-[remote-fullscreen=true]/dashboard:p-0 group-data-[remote-fullscreen=true]/dashboard:shadow-none group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-0 [@media(max-width:1023px)_and_(orientation:landscape)]:relative [@media(max-width:1023px)_and_(orientation:landscape)]:z-auto [@media(max-width:1023px)_and_(orientation:landscape)]:m-0 [@media(max-width:1023px)_and_(orientation:landscape)]:w-auto [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-none [@media(max-width:1023px)_and_(orientation:landscape)]:p-0 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-none [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-0 [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max gap-2 group-data-[remote-fullscreen=true]/dashboard:gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:gap-[0.3rem]">
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

            <div className="hidden w-px shrink-0 self-stretch bg-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />

            <div className="-mx-2.5 mt-1.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none] group-data-[remote-fullscreen=true]/dashboard:relative group-data-[remote-fullscreen=true]/dashboard:z-auto group-data-[remote-fullscreen=true]/dashboard:m-0 group-data-[remote-fullscreen=true]/dashboard:overflow-visible group-data-[remote-fullscreen=true]/dashboard:p-0 group-data-[remote-fullscreen=true]/dashboard:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:relative [@media(max-width:1023px)_and_(orientation:landscape)]:z-auto [@media(max-width:1023px)_and_(orientation:landscape)]:m-0 [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-visible [@media(max-width:1023px)_and_(orientation:landscape)]:p-0 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max gap-2 group-data-[remote-fullscreen=true]/dashboard:gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:gap-[0.3rem]">
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
          </div>

          <div className={`mt-1.5 min-h-0 flex-1 overflow-y-auto pb-1 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!relative [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!inset-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!m-0 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!mt-2 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!max-h-[calc(48svh-6.75rem)] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!overflow-y-auto [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pb-1 [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!pointer-events-auto ${
            activeTab === 'move'
              ? 'group-data-[remote-fullscreen=true]/dashboard:pointer-events-none group-data-[remote-fullscreen=true]/dashboard:absolute group-data-[remote-fullscreen=true]/dashboard:inset-0 group-data-[remote-fullscreen=true]/dashboard:z-[30] group-data-[remote-fullscreen=true]/dashboard:m-0 group-data-[remote-fullscreen=true]/dashboard:overflow-visible group-data-[remote-fullscreen=true]/dashboard:p-0 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0 [@media(max-width:1023px)_and_(orientation:landscape)]:m-0 [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-visible [@media(max-width:1023px)_and_(orientation:landscape)]:p-0'
              : 'group-data-[remote-fullscreen=true]/dashboard:pointer-events-auto group-data-[remote-fullscreen=true]/dashboard:absolute group-data-[remote-fullscreen=true]/dashboard:bottom-[6rem] group-data-[remote-fullscreen=true]/dashboard:right-7 group-data-[remote-fullscreen=true]/dashboard:top-[7.25rem] group-data-[remote-fullscreen=true]/dashboard:z-[40] group-data-[remote-fullscreen=true]/dashboard:m-0 group-data-[remote-fullscreen=true]/dashboard:w-[min(28rem,34vw)] group-data-[remote-fullscreen=true]/dashboard:overflow-auto group-data-[remote-fullscreen=true]/dashboard:rounded-lg group-data-[remote-fullscreen=true]/dashboard:border group-data-[remote-fullscreen=true]/dashboard:border-accent-data/30 group-data-[remote-fullscreen=true]/dashboard:bg-surface-primary/72 group-data-[remote-fullscreen=true]/dashboard:p-4 group-data-[remote-fullscreen=true]/dashboard:shadow-[0_1.25rem_3rem_rgba(0,0,0,0.20)] group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-lg [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:bottom-16 [@media(max-width:1023px)_and_(orientation:landscape)]:right-[0.85rem] [@media(max-width:1023px)_and_(orientation:landscape)]:top-[7.9rem] [@media(max-width:1023px)_and_(orientation:landscape)]:m-0 [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(25rem,42vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-auto [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/70 [@media(max-width:1023px)_and_(orientation:landscape)]:p-[0.85rem] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_1.25rem_3rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-lg'
          }`}
          >
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
