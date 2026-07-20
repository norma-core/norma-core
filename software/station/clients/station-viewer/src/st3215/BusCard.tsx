import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import { Camera } from 'lucide-react';
import { Link } from 'react-router-dom';
import { commandManager } from '@/api/commands';
import { supportsGravityComp, supportsSt3215Device } from '@/devices/registry';
import { FrameEntry } from '@/api/frame-parser';
import { useElementFullscreen } from '@/hooks/useElementFullscreen';
import { motors_mirroring, st3215, usbvideo } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { getLatencyBgColor, getLatencyTextColor } from '@/utils/color-utils';
import CameraViewer from '@/usbvideo/CameraViewer';
import RobotCameraView from '@/usbvideo/RobotCameraView';
import BusWebGLRenderer from '@/st3215/BusWebGLRenderer';
import CameraHudControls from '@/st3215/CameraHudControls';
import MotorDataTable from '@/st3215/MotorDataTable';
import { ADDR_GOAL_POSITION, getMotorPosition } from '@/st3215/motor-parser';

interface LatencyReading {
  timestamp: number;
  latency: number;
}

interface LatencyStats {
  avg: number;
  min: number;
  max: number;
}

const STALE_CAMERA_MAX_AGE_MS = 60_000;
const MIN_CALIBRATED_RANGE = 100;
const WEB_CONTROL_STORAGE_TTL_MS = 60_000;
const WEB_CONTROL_MIRROR_IGNORE_AFTER_LOCAL_REQUEST_MS = 5_000;
const WEB_CONTROL_MIRROR_CONFIRM_MS = 800;
// Matches motors-mirroring's GravityCompConfig defaults and hard ceilings
// (software/drivers/motors-mirroring/src/config.rs) - needs empirical
// tuning on real hardware, these are just starting points.
const DEFAULT_GRAVITY_COMP_GAIN = 0.05;
const MAX_GRAVITY_COMP_GAIN = 1.0;
const DEFAULT_GRAVITY_COMP_TORQUE_LIMIT = 100;
const MAX_GRAVITY_COMP_TORQUE_LIMIT = 150;

type RobotViewMode = 'model' | 'camera';
type CameraLayoutMode = 'pip' | 'side-by-side' | 'stacked';
type CameraFitMode = 'contain' | 'cover';

type ActiveVideoSource = {
  id: string;
  label: string;
  shortLabel: string;
  data: usbvideo.IRxEnvelope;
  queueId: string;
};

interface BusCardProps {
  bus: st3215.InferenceState.IBusState;
  busIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  allBuses?: st3215.InferenceState.IBusState[] | null;
  mirroringState?: motors_mirroring.IInferenceState;
}

const BusCard: React.FC<BusCardProps> = ({
  bus,
  busIndex,
  videoSources,
  allBuses,
  mirroringState,
}) => {
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());
  const hasPrimaryVideoSourcePreferenceRef = useRef(false);
  const lastWebControlRequestMsRef = useRef(0);
  const mirrorSeenWhileWebControlAtRef = useRef<number | null>(null);
  const [primaryVideoSourceId, setPrimaryVideoSourceId] = useState<string | null>(null);
  const [secondaryVideoSourceId, setSecondaryVideoSourceId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<RobotViewMode>('model');
  const [cameraLayout, setCameraLayout] = useState<CameraLayoutMode>('pip');
  const [primaryCameraFit, setPrimaryCameraFit] = useState<CameraFitMode>('contain');
  const [secondaryCameraFit, setSecondaryCameraFit] = useState<CameraFitMode>('contain');
  const [showCameraMotorData, setShowCameraMotorData] = useState(false);
  const [isWebControlled, setIsWebControlled] = useState(false);
  const cameraContentRef = useRef<HTMLDivElement>(null);
  const {
    isFullscreen: isCameraFullscreen,
    toggleFullscreen: toggleCameraFullscreen,
    exitFullscreen: exitCameraFullscreen,
  } = useElementFullscreen(cameraContentRef);
  const busSerialNumber = bus.bus?.serialNumber ?? null;
  const webControlledStorageKey = busSerialNumber
    ? `station-viewer:web-controlled:${busSerialNumber}`
    : null;

  const activeVideoSources = useMemo(() => {
    const nowMs = Date.now();

    const isFresh = (entry: FrameEntry<usbvideo.IRxEnvelope>) => {
      const monotonicStampNs = entry.data.stamp?.monotonicStampNs;
      if (!monotonicStampNs) {
        return true;
      }

      const localStampNs = serverToLocal(Long.fromValue(monotonicStampNs));
      const ageMs = nowMs - localStampNs.toNumber() / 1e6;

      return ageMs <= STALE_CAMERA_MAX_AGE_MS;
    };

    const sources: ActiveVideoSource[] = [
      ...(videoSources ?? []).filter(isFresh).map((entry) => ({
        id: entry.data.camera?.uniqueId || entry.queueId,
        label: `${entry.data.camera?.deviceNumber ?? 'USB'} (${entry.data.camera?.uniqueId ?? 'unknown'})`,
        shortLabel: entry.data.camera?.deviceNumber !== undefined
          ? String(entry.data.camera.deviceNumber)
          : 'Camera',
        data: entry.data,
        queueId: entry.queueId,
      })),
    ];

    return sources;
  }, [videoSources]);

  const activeVideoSourceIds = useMemo(
    () => activeVideoSources.map((entry) => entry.id),
    [activeVideoSources],
  );
  const firstActiveVideoSourceId = activeVideoSourceIds[0] ?? null;

  const currentMirror = mirroringState?.mirroring?.find((m) =>
    m.targets?.some((t) => t.id?.uniqueId === busSerialNumber),
  );

  const gravityCompEntry = mirroringState?.gravityComp?.find(
    (g) => g.id?.uniqueId === busSerialNumber,
  );
  const isGravityCompEnabled = gravityCompEntry?.state === motors_mirroring.GravityCompState.GC_ENABLED;
  const isFollowerBus = mirroringState?.modes?.some(
    (m) => m.id?.uniqueId === busSerialNumber && m.mode === motors_mirroring.BusMode.BR_FOLLOWER,
  );
  const gravityCompSupported = supportsGravityComp(bus);

  // Per-joint gains (motor 1-7 -> gain), falling back to the built-in
  // default for any joint the backend hasn't reported yet (e.g. never
  // touched on this bus).
  const gravityCompJointGains = useMemo(() => {
    const gains: Record<number, number> = {};
    for (let motorId = 1; motorId <= 7; motorId++) {
      gains[motorId] = gravityCompEntry?.jointGainsRadPerNm?.[motorId - 1] ?? DEFAULT_GRAVITY_COMP_GAIN;
    }
    return gains;
  }, [gravityCompEntry?.jointGainsRadPerNm]);

  const [gravityCompTorqueLimit, setGravityCompTorqueLimit] = useState<number>(DEFAULT_GRAVITY_COMP_TORQUE_LIMIT);
  const isEditingTorqueLimitRef = useRef(false);

  useEffect(() => {
    if (isEditingTorqueLimitRef.current) {
      return;
    }
    if (typeof gravityCompEntry?.torqueLimit === 'number') {
      setGravityCompTorqueLimit(gravityCompEntry.torqueLimit);
    }
  }, [gravityCompEntry?.torqueLimit]);

  useEffect(() => {
    if (!busSerialNumber || !gravityCompSupported) {
      return;
    }
    // Deliberately excludes `bus` from deps - it's a new object reference
    // every poll (~50Hz), which would fire this on every frame regardless
    // of whether anything actually changed. This only logs on real
    // transitions.
    console.log('[GravityComp] state', {
      bus: busSerialNumber,
      enabled: isGravityCompEnabled,
      jointGainsRadPerNm: gravityCompEntry?.jointGainsRadPerNm,
      torqueLimit: gravityCompEntry?.torqueLimit,
    });
  }, [gravityCompSupported, busSerialNumber, isGravityCompEnabled, gravityCompEntry?.jointGainsRadPerNm, gravityCompEntry?.torqueLimit]);

  const setWebControlledState = useCallback((nextState: boolean) => {
    setIsWebControlled(nextState);
    if (webControlledStorageKey) {
      if (!nextState) {
        sessionStorage.removeItem(webControlledStorageKey);
        return;
      }

      sessionStorage.setItem(
        webControlledStorageKey,
        JSON.stringify({
          enabled: true,
          timestamp: Date.now(),
        }),
      );
    }
  }, [webControlledStorageKey]);

  useEffect(() => {
    if (primaryVideoSourceId && !activeVideoSourceIds.includes(primaryVideoSourceId)) {
      setPrimaryVideoSourceId(null);
      hasPrimaryVideoSourcePreferenceRef.current = false;
    }

    if (
      !primaryVideoSourceId &&
      firstActiveVideoSourceId &&
      !hasPrimaryVideoSourcePreferenceRef.current
    ) {
      setPrimaryVideoSourceId(firstActiveVideoSourceId);
    }

    if (
      secondaryVideoSourceId &&
      (!activeVideoSourceIds.includes(secondaryVideoSourceId) || secondaryVideoSourceId === primaryVideoSourceId)
    ) {
      setSecondaryVideoSourceId(null);
    }
  }, [
    activeVideoSourceIds,
    firstActiveVideoSourceId,
    primaryVideoSourceId,
    secondaryVideoSourceId,
  ]);

  useEffect(() => {
    if (!webControlledStorageKey) {
      setIsWebControlled(false);
      return;
    }

    const persistedValue = sessionStorage.getItem(webControlledStorageKey);
    if (!persistedValue) {
      setIsWebControlled(false);
      return;
    }

    try {
      const parsedValue = JSON.parse(persistedValue) as { enabled?: boolean; timestamp?: number };
      const isFresh = typeof parsedValue.timestamp === 'number'
        && Date.now() - parsedValue.timestamp <= WEB_CONTROL_STORAGE_TTL_MS;
      const isEnabled = parsedValue.enabled === true && isFresh;

      setIsWebControlled(isEnabled);
      if (!isEnabled) {
        sessionStorage.removeItem(webControlledStorageKey);
      }
    } catch {
      setIsWebControlled(false);
      sessionStorage.removeItem(webControlledStorageKey);
    }
  }, [webControlledStorageKey]);

  useEffect(() => {
    if (!isWebControlled) {
      mirrorSeenWhileWebControlAtRef.current = null;
      return;
    }

    if (!currentMirror) {
      mirrorSeenWhileWebControlAtRef.current = null;
      return;
    }

    const nowMs = Date.now();
    const isTooSoonAfterLocalRequest =
      nowMs - lastWebControlRequestMsRef.current < WEB_CONTROL_MIRROR_IGNORE_AFTER_LOCAL_REQUEST_MS;

    if (isTooSoonAfterLocalRequest) {
      mirrorSeenWhileWebControlAtRef.current = null;
      return;
    }

    if (mirrorSeenWhileWebControlAtRef.current === null) {
      mirrorSeenWhileWebControlAtRef.current = nowMs;
      return;
    }

    const hasPersistentMirrorWhileWebControl =
      nowMs - mirrorSeenWhileWebControlAtRef.current >= WEB_CONTROL_MIRROR_CONFIRM_MS;

    if (!hasPersistentMirrorWhileWebControl) {
      return;
    }

    mirrorSeenWhileWebControlAtRef.current = null;
    setWebControlledState(false);
  }, [currentMirror, isWebControlled, setWebControlledState]);

  const handlePrimaryVideoSourceChange = useCallback((sourceId: string | null) => {
    // Keep this sticky even for "None" so an explicit user clear is not auto-filled again.
    hasPrimaryVideoSourcePreferenceRef.current = true;
    setPrimaryVideoSourceId(sourceId);
    if (sourceId && sourceId === secondaryVideoSourceId) {
      setSecondaryVideoSourceId(null);
    }
  }, [secondaryVideoSourceId]);

  const handleCameraChipClick = useCallback((sourceId: string) => {
    if (sourceId === primaryVideoSourceId) {
      hasPrimaryVideoSourcePreferenceRef.current = true;
      setPrimaryVideoSourceId(secondaryVideoSourceId);
      setSecondaryVideoSourceId(null);
      return;
    }

    if (sourceId === secondaryVideoSourceId) {
      setSecondaryVideoSourceId(null);
      return;
    }

    if (!primaryVideoSourceId) {
      hasPrimaryVideoSourcePreferenceRef.current = true;
      setPrimaryVideoSourceId(sourceId);
      return;
    }

    setSecondaryVideoSourceId(sourceId);
  }, [primaryVideoSourceId, secondaryVideoSourceId]);

  const handleSwapVideoSources = useCallback(() => {
    if (!primaryVideoSourceId || !secondaryVideoSourceId) {
      return;
    }

    setPrimaryVideoSourceId(secondaryVideoSourceId);
    setSecondaryVideoSourceId(primaryVideoSourceId);
    hasPrimaryVideoSourcePreferenceRef.current = true;
  }, [primaryVideoSourceId, secondaryVideoSourceId]);

  const handleControlSourceChange = useCallback(async (sourceBusSerial: string | null) => {
    if (!busSerialNumber) {
      return;
    }

    // Gravity comp and any other control source (web-controlled or
    // mirroring) both continuously write GoalPosition to this bus's own
    // motors - if gravity comp were left running, it would fight whatever
    // this control source tries to do 20ms later. Stop it first.
    if (isGravityCompEnabled) {
      console.log('[GravityComp] stopping: control source changed', { bus: busSerialNumber, sourceBusSerial });
      await commandManager.sendGravityCompCommand({
        type: motors_mirroring.GravityCompCommandType.GCT_STOP_GRAVITY_COMP,
        bus: { type: motors_mirroring.BusType.MBT_ST3215, uniqueId: busSerialNumber },
      });
    }

    if (sourceBusSerial === 'web-controlled') {
      const target: motors_mirroring.IMirroringBus = {
        type: motors_mirroring.BusType.MBT_ST3215,
        uniqueId: busSerialNumber,
      };

      await commandManager.sendMirroringCommand({
        type: motors_mirroring.CommandType.CT_STOP_MIRROR,
        source: target,
      });

      // Freeze all motors by sending their current positions
      if (bus.motors) {
        const commands = [];
        for (const motor of bus.motors) {
          if (motor.id !== null && motor.id !== undefined && motor.state) {
            const currentPosition = getMotorPosition(motor.state);

            // Send command to set motor to its current position (freeze it)
            const command = st3215.Command.create({
              targetBusSerial: busSerialNumber,
              write: {
                motorId: motor.id,
                address: ADDR_GOAL_POSITION,
                value: new Uint8Array([
                  currentPosition & 0xff,
                  (currentPosition >> 8) & 0xff,
                ]),
              },
            });
            commands.push(command);
          }
        }
        if (commands.length > 0) {
          await commandManager.sendSt3215Commands(commands);
        }
      }

      lastWebControlRequestMsRef.current = Date.now();
      setWebControlledState(true);
      return;
    }

    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: busSerialNumber,
    };

    if (sourceBusSerial) {
      const source: motors_mirroring.IMirroringBus = {
        type: motors_mirroring.BusType.MBT_ST3215,
        uniqueId: sourceBusSerial,
      };
      await commandManager.sendMirroringCommand({
        type: motors_mirroring.CommandType.CT_START_MIRROR,
        source: source,
        targets: [target],
      });
      setWebControlledState(false);
    } else {
      await commandManager.sendMirroringCommand({
        type: motors_mirroring.CommandType.CT_STOP_MIRROR,
        source: target,
      });
      setWebControlledState(false);
    }
  }, [bus.motors, busSerialNumber, isGravityCompEnabled, setWebControlledState]);

  const handleGravityCompToggle = useCallback(async () => {
    if (!busSerialNumber) {
      return;
    }

    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: busSerialNumber,
    };

    // No gain/torque-limit payload needed on start - the backend seeds the
    // running task from whatever's already staged/saved for this bus (or
    // its configured defaults), so per-joint table edits and the torque
    // limit field made before pressing this button already take effect.
    const command: motors_mirroring.IGravityCompCommand = {
      type: isGravityCompEnabled
        ? motors_mirroring.GravityCompCommandType.GCT_STOP_GRAVITY_COMP
        : motors_mirroring.GravityCompCommandType.GCT_START_GRAVITY_COMP,
      bus: target,
    };

    console.log('[GravityComp] sending command', command);
    await commandManager.sendGravityCompCommand(command);
  }, [busSerialNumber, isGravityCompEnabled]);

  // Per-joint gain edit (from the "Gravity" column in MotorDataTable).
  // Applies live if gravity comp is running, and is always remembered
  // (staged) server-side regardless, ready for the next Start or an
  // explicit Save.
  const handleGravityCompJointGainChange = useCallback(async (motorId: number, nextGain: number) => {
    if (!busSerialNumber) {
      return;
    }

    const clamped = Math.min(Math.max(nextGain, 0), MAX_GRAVITY_COMP_GAIN);
    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: busSerialNumber,
    };

    console.log('[GravityComp] setting joint gain', { bus: busSerialNumber, motorId, gainRadPerNm: clamped });
    await commandManager.sendGravityCompCommand({
      type: motors_mirroring.GravityCompCommandType.GCT_SET_GAIN,
      bus: target,
      motorId,
      gainRadPerNm: clamped,
    });
  }, [busSerialNumber]);

  const commitGravityCompTorqueLimit = useCallback(async (nextValue: number) => {
    if (!busSerialNumber) {
      return;
    }

    const clamped = Math.min(Math.max(Math.round(nextValue), 0), MAX_GRAVITY_COMP_TORQUE_LIMIT);
    setGravityCompTorqueLimit(clamped);

    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: busSerialNumber,
    };

    console.log('[GravityComp] setting torque limit', { bus: busSerialNumber, torqueLimit: clamped });
    await commandManager.sendGravityCompCommand({
      type: motors_mirroring.GravityCompCommandType.GCT_SET_TORQUE_LIMIT,
      bus: target,
      torqueLimit: clamped,
    });
  }, [busSerialNumber]);

  const handleSaveGravitySettings = useCallback(async () => {
    if (!busSerialNumber) {
      return;
    }

    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: busSerialNumber,
    };

    console.log('[GravityComp] saving settings', { bus: busSerialNumber });
    await commandManager.sendGravityCompCommand({
      type: motors_mirroring.GravityCompCommandType.GCT_SAVE_SETTINGS,
      bus: target,
    });
  }, [busSerialNumber]);

  // Function to calculate moving average for latency (15 second window)
  const getMovingAverageLatency = (
    key: string,
    currentLatency: number,
  ): LatencyStats => {
    const now = Date.now();
    // Clamp to prevent negative values
    const validLatency = Math.max(0, currentLatency);

    const history = latencyHistoryRef.current.get(key) || [];

    // Add current reading
    history.push({ timestamp: now, latency: validLatency });

    // Filter to keep only last 15 seconds
    const filtered = history.filter((h) => now - h.timestamp <= 15000);
    latencyHistoryRef.current.set(key, filtered);

    // Calculate statistics
    if (filtered.length === 0) {
      return { avg: validLatency, min: validLatency, max: validLatency };
    }

    const latencies = filtered.map((h) => h.latency);
    const sum = latencies.reduce((acc, l) => acc + l, 0);

    return {
      avg: sum / filtered.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
    };
  };

  const adjustedBusStamp = bus.monotonicStampNs
    ? serverToLocal(Long.fromValue(bus.monotonicStampNs))
    : null;
  const now = Date.now();
  const busLatency = adjustedBusStamp
    ? now - adjustedBusStamp.toNumber() / 1e6
    : 0;
  const busLatencyAvg = getMovingAverageLatency(`bus-${busIndex}`, busLatency);

  const hasMotors = (bus.motors?.length ?? 0) > 0;
  const hasUnfrozenMotor =
    hasMotors && bus.motors!.some((motor) => motor.rangeFreezed !== true);
  const hasNarrowRange =
    hasMotors &&
    bus.motors!.some(
      (motor) =>
        (motor.rangeMax ?? 0) - (motor.rangeMin ?? 0) < MIN_CALIBRATED_RANGE,
    );
  const needsCalibration = hasMotors && (hasUnfrozenMotor || hasNarrowRange);
  const canRender3d = supportsSt3215Device(bus);
  const canShowCamera = activeVideoSources.length > 0;

  useEffect(() => {
    if (!canShowCamera && viewMode === 'camera') {
      setViewMode('model');
    }
  }, [canShowCamera, viewMode]);

  const controlSourceWidthClass = viewMode === "camera" ? "w-[170px]" : "max-w-[180px]";
  const cameraSelectWidthClass = viewMode === "camera" ? "w-[150px]" : "max-w-[180px]";
  const selectControlClass = "block h-9 min-w-0 rounded-md border border-border-subtle bg-surface-secondary pl-3 pr-10 text-sm text-text-primary focus:border-accent-success-deep focus:outline-none focus:ring-accent-success-deep";
  const primaryVideoSourceOptions = useMemo(
    () =>
      viewMode === "camera"
        ? activeVideoSources.filter((entry) => entry.id !== secondaryVideoSourceId)
        : activeVideoSources,
    [activeVideoSources, secondaryVideoSourceId, viewMode],
  );

  useEffect(() => {
    if (viewMode === "camera") {
      return;
    }

    void exitCameraFullscreen();
  }, [exitCameraFullscreen, viewMode]);

  return (
    <div className="min-w-0 border border-border-default rounded-lg bg-surface-primary/50">
      {/* Title Bar */}
      <div className="bg-surface-secondary/50 px-4 py-2 rounded-t-lg flex flex-col gap-2 border-b border-border-default items-start">
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="font-bold text-lg text-accent-data">
            #{bus.bus?.serialNumber}
          </span>
          <div className="flex rounded-md border border-border-subtle bg-surface-primary p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("model")}
              className={`flex h-8 min-w-8 items-center justify-center rounded px-2 text-xs font-bold transition-colors ${viewMode === "model" ? "bg-accent-success-bg text-text-primary" : "text-text-muted hover:text-text-primary"}`}
              title="3D view"
              aria-label="3D view"
            >
              3D
            </button>
            <button
              type="button"
              onClick={() => setViewMode("camera")}
              disabled={!canShowCamera}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:text-text-muted ${viewMode === "camera" ? "bg-accent-data text-surface-base" : "text-text-muted hover:text-text-primary"}`}
              title={canShowCamera ? "Camera-first robot view" : "No active cameras"}
              aria-label="Camera view"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {gravityCompSupported && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleGravityCompToggle}
                disabled={!busSerialNumber || isFollowerBus}
                className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isGravityCompEnabled
                    ? "border-accent-warning-deep bg-accent-warning-deep text-surface-base"
                    : "border-border-subtle bg-surface-primary text-text-muted hover:text-text-primary"
                }`}
                title={
                  isFollowerBus
                    ? "Gravity compensation is only available on a self-controlled or leader arm"
                    : isGravityCompEnabled
                      ? "Disable gravity compensation"
                      : "Enable gravity compensation"
                }
              >
                <span
                  className={`h-2 w-2 rounded-full ${isGravityCompEnabled ? "animate-pulse bg-surface-base" : "bg-text-muted"}`}
                  aria-hidden="true"
                />
                {isGravityCompEnabled ? "Gravity Comp: ON" : "Gravity Comp"}
              </button>
              <label
                className="flex items-center gap-1 text-[10px] font-semibold uppercase text-text-muted"
                htmlFor={`gravity-comp-torque-limit-${busSerialNumber ?? "unknown"}`}
              >
                Torque
                <input
                  id={`gravity-comp-torque-limit-${busSerialNumber ?? "unknown"}`}
                  type="number"
                  min={0}
                  max={MAX_GRAVITY_COMP_TORQUE_LIMIT}
                  step={1}
                  value={gravityCompTorqueLimit}
                  disabled={!busSerialNumber || isFollowerBus}
                  onFocus={() => {
                    isEditingTorqueLimitRef.current = true;
                  }}
                  onChange={(e) => setGravityCompTorqueLimit(Number(e.target.value))}
                  onBlur={(e) => {
                    isEditingTorqueLimitRef.current = false;
                    void commitGravityCompTorqueLimit(Number(e.target.value));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-9 w-16 rounded-md border border-border-subtle bg-surface-primary px-2 text-xs font-normal normal-case text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  title="Gravity comp torque limit (global, all arm motors) - hard-capped in firmware regardless of value entered here"
                  aria-label="Gravity compensation torque limit"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSaveGravitySettings()}
                disabled={!busSerialNumber || isFollowerBus}
                className="flex h-9 items-center rounded-md border border-border-subtle bg-surface-primary px-2 text-xs font-bold text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                title="Persist the current per-joint gains and torque limit so they're restored after a restart"
              >
                Save Gravity
              </button>
            </div>
          )}
          <select
            value={
              isWebControlled
                ? "web-controlled"
                : (currentMirror?.source?.id?.uniqueId ?? "")
            }
            onChange={(e) => handleControlSourceChange(e.target.value || null)}
            disabled={!busSerialNumber}
            className={`${selectControlClass} ${controlSourceWidthClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="">(Self-controlled)</option>
            <option value="web-controlled">(Web-controlled)</option>
            {allBuses?.map((sourceBus) => {
              if (
                !sourceBus.bus?.serialNumber ||
                sourceBus.bus.serialNumber === bus.bus?.serialNumber
              ) {
                return null;
              }
              return (
                <option
                  key={sourceBus.bus.serialNumber}
                  value={sourceBus.bus.serialNumber}
                  title={`#${sourceBus.bus.serialNumber}`}
                >
                  #{sourceBus.bus.serialNumber}
                </option>
              );
            })}
          </select>
          {viewMode === "camera" ? (
            <div
              className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Camera selection"
            >
              {activeVideoSources.map((entry) => {
                const sourceId = entry.id;
                const label = entry.label;
                const shortLabel = entry.shortLabel;
                const role =
                  sourceId === primaryVideoSourceId
                    ? "MAIN"
                    : sourceId === secondaryVideoSourceId
                      ? "AUX"
                      : null;
                const chipTitle =
                  role === "MAIN"
                    ? `MAIN: ${label}. Click to clear; AUX becomes MAIN.`
                    : role === "AUX"
                      ? `AUX: ${label}. Click to clear.`
                      : primaryVideoSourceId
                        ? `Select ${label} as AUX camera.`
                        : `Select ${label} as MAIN camera.`;

                return (
                  <button
                    key={`${entry.queueId}-${sourceId}`}
                    type="button"
                    onClick={() => handleCameraChipClick(sourceId)}
                    className={`flex h-9 max-w-[9rem] items-center gap-1.5 rounded-md border px-2.5 text-sm font-bold transition-colors ${
                      role === "MAIN"
                        ? "border-accent-data bg-accent-data text-surface-base"
                        : role === "AUX"
                          ? "border-accent-success-deep bg-accent-success-bg text-text-primary"
                          : "border-border-subtle bg-surface-primary text-text-muted hover:text-text-primary"
                    }`}
                    title={chipTitle}
                    aria-label={role ? `${role} camera ${label}` : `Select camera ${label}`}
                  >
                    <span className="truncate">{shortLabel}</span>
                    {role && (
                      <span className="rounded bg-black/20 px-1 py-0.5 text-[10px] leading-none">
                        {role}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <select
              value={primaryVideoSourceId ?? ""}
              onChange={(e) => handlePrimaryVideoSourceChange(e.target.value || null)}
              className={`${selectControlClass} ${cameraSelectWidthClass}`}
              title="Main camera"
            >
              <option value="">None</option>
              {primaryVideoSourceOptions.map((entry) => {
                const sourceId = entry.id;
                const label = entry.label;
                return (
                  <option
                    key={`${entry.queueId}-${sourceId}`}
                    value={sourceId}
                    title={label}
                  >
                    {label}
                  </option>
                );
              })}
            </select>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Port:</span>
            <span className="text-accent-data">{bus.bus?.portName || "N/A"}</span>
          </div>
          <span className={`${getLatencyTextColor(busLatency)}`}>
            {busLatencyAvg.avg < 1000
              ? `${busLatencyAvg.avg.toFixed(0)}ms`
              : `${(busLatencyAvg.avg / 1000).toFixed(1)}s`}
          </span>
          <span
            className={`w-3 h-3 rounded-full ${getLatencyBgColor(busLatency, false)}`}
          ></span>
        </div>
      </div>

      {/* Content */}
      <div
        ref={cameraContentRef}
        className={`relative ${isCameraFullscreen ? "h-screen bg-black" : "h-180"}`}
      >
        {viewMode === "camera" ? (
          <>
            <RobotCameraView
              primaryVideoSourceId={primaryVideoSourceId}
              secondaryVideoSourceId={secondaryVideoSourceId}
              bus={bus}
              busIndex={busIndex}
              showMotorData={showCameraMotorData}
              showCalibrateButton={true}
              needsCalibration={needsCalibration}
              isWebControlled={isWebControlled}
              cameraLayout={cameraLayout}
              primaryCameraFit={primaryCameraFit}
              secondaryCameraFit={secondaryCameraFit}
              onPrimaryCameraFitToggle={() => setPrimaryCameraFit((fit) => (fit === "contain" ? "cover" : "contain"))}
              onSecondaryCameraFitToggle={() => setSecondaryCameraFit((fit) => (fit === "contain" ? "cover" : "contain"))}
              gravityCompJointGains={gravityCompSupported ? gravityCompJointGains : undefined}
              onGravityCompJointGainChange={handleGravityCompJointGainChange}
            />
            <CameraHudControls
              cameraLayout={cameraLayout}
              hasMotors={hasMotors}
              showMotorData={showCameraMotorData}
              isFullscreen={isCameraFullscreen}
              canSwapCameras={Boolean(primaryVideoSourceId && secondaryVideoSourceId)}
              onSetPipLayout={() => setCameraLayout('pip')}
              onToggleSplitLayout={() =>
                setCameraLayout((layout) => (layout === 'side-by-side' ? 'stacked' : 'side-by-side'))
              }
              onSwapCameras={handleSwapVideoSources}
              onToggleMotorData={() => setShowCameraMotorData((prev) => !prev)}
              onToggleFullscreen={toggleCameraFullscreen}
            />
          </>
        ) : canRender3d ? (
          <BusWebGLRenderer
            busSerialNumber={bus.bus?.serialNumber}
            bus={bus}
            busIndex={busIndex}
            showMotorData={true}
            selectedVideoSourceId={primaryVideoSourceId}
            showCalibrateButton={true}
            needsCalibration={needsCalibration}
            isWebControlled={isWebControlled}
            gravityCompJointGains={gravityCompSupported ? gravityCompJointGains : undefined}
            onGravityCompJointGainChange={handleGravityCompJointGainChange}
          />
        ) : (
          <>
            <div className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-surface-primary/20">
              <p className="text-accent-warning mb-4 text-center">
                {(bus.motors?.length || 0) === 0 ? (
                  <>No motors connected to this bus.</>
                ) : (
                  <>
                    3D model visualization is only available for registered
                    device modules.
                    <br />
                    This bus has {bus.motors?.length} motor
                    {bus.motors?.length === 1 ? "" : "s"}.
                    {bus.motors?.length === 1 && (
                      <>
                        <br />
                        Single motor control uses the raw 0-4095 servo range.
                      </>
                    )}
                  </>
                )}
              </p>
              <div className="flex gap-4">
                {(bus.motors?.length || 0) > 1 && (
                  <Link
                    to="/st3215-bus-calibration"
                    state={{ bus }}
                    className={`px-4 py-2 rounded text-base font-bold transition-colors bg-accent-success-bg text-text-primary hover:bg-accent-success-deep ${needsCalibration ? "ring-4 ring-accent-success-deep/50 scale-110" : ""}`}
                  >
                    Calibrate
                  </Link>
                )}
                {bus.motors?.length === 1 && (
                  <Link
                    to={`/st3215-bind-motors`}
                    state={{ bus }}
                    className="bg-accent-info-bg hover:bg-accent-info-deep px-4 py-2 rounded text-text-primary transition-colors"
                    title="Configure motor ID"
                  >
                    Configure Motor ID
                  </Link>
                )}
              </div>
            </div>
            <div className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto">
                <MotorDataTable
                  bus={bus}
                  busIndex={busIndex}
                  isWebControlled={isWebControlled}
                  gravityCompJointGains={gravityCompSupported ? gravityCompJointGains : undefined}
                  onGravityCompJointGainChange={handleGravityCompJointGainChange}
                />
              </div>
            </div>
            {primaryVideoSourceId && (
              <div className="absolute top-4 right-4 h-[200px] w-2/5 max-w-[520px] overflow-hidden rounded-lg border border-border-default bg-black shadow-lg pointer-events-auto">
                <CameraViewer sourceId={primaryVideoSourceId} className="h-full w-full" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BusCard;
