import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { st3215, usbvideo, motors_mirroring, ov5647 } from "../api/proto";
import BusWebGLRenderer from "./BusWebGLRenderer";
import CameraViewer from "../usbvideo/CameraViewer";
import Ov5647CameraViewer from "../ov5647/CameraViewer";
import { serverToLocal } from "../api/timestamp-utils";
import Long from "long";
import { commandManager } from "../api/commands";
import { getMotorPosition } from "./motor-parser";
import MotorDataTable from "./MotorDataTable";
import { getLatencyBgColor, getLatencyTextColor } from "@/utils/color-utils";

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

import { FrameEntry } from "../api/frame-parser";

interface BusCardProps {
  bus: st3215.InferenceState.IBusState;
  busIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
  allBuses?: st3215.InferenceState.IBusState[] | null;
  mirroringState?: motors_mirroring.IInferenceState;
}

const BusCard: React.FC<BusCardProps> = ({
  bus,
  busIndex,
  videoSources,
  ov5647Sources,
  allBuses,
  mirroringState,
}) => {
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState<
    string | null
  >(null);
  const [isWebControlled, setIsWebControlled] = useState(false);

  const activeVideoSources = useMemo(() => {
    const nowMs = Date.now();

    const isFresh = (entry: FrameEntry<usbvideo.IRxEnvelope> | FrameEntry<ov5647.IRxEnvelope>) => {
      const monotonicStampNs = entry.data.stamp?.monotonicStampNs;
      if (!monotonicStampNs) {
        return true;
      }

      const localStampNs = serverToLocal(Long.fromValue(monotonicStampNs));
      const ageMs = nowMs - localStampNs.toNumber() / 1e6;

      return ageMs <= STALE_CAMERA_MAX_AGE_MS;
    };

    return [
      ...(videoSources ?? []).filter(isFresh).map((entry) => ({
        id: entry.data.camera?.uniqueId ? `usbvideo:${entry.data.camera.uniqueId}` : '',
        label: `${entry.data.camera?.deviceNumber ?? 'USB'} (${entry.data.camera?.uniqueId ?? 'unknown'})`,
        kind: 'usbvideo' as const,
        data: entry.data,
        queueId: entry.queueId,
      })),
      ...(ov5647Sources ?? []).filter(isFresh).map((entry) => {
        const cameraId = entry.data.camera?.uniqueId || entry.data.camera?.id || '';
        return {
          id: cameraId ? `ov5647:${cameraId}` : '',
          label: `OV5647 ${entry.data.camera?.name || entry.data.camera?.id || 'camera'} (${cameraId || 'unknown'})`,
          kind: 'ov5647' as const,
          data: entry.data,
          queueId: entry.queueId,
        };
      }),
    ].filter((entry) => entry.id);
  }, [ov5647Sources, videoSources]);

  const selectedVideoSource = activeVideoSources.find(
    (entry) => entry.id === selectedVideoSourceId,
  );

  useEffect(() => {
    if (!selectedVideoSourceId) {
      return;
    }

    const hasSelectedSource = activeVideoSources.some(
      (entry) => entry.id === selectedVideoSourceId,
    );

    if (!hasSelectedSource) {
      setSelectedVideoSourceId(null);
    }
  }, [activeVideoSources, selectedVideoSourceId]);

  const handleControlSourceChange = async (sourceBusSerial: string | null) => {
    if (!bus.bus?.serialNumber) {
      return;
    }

    // Handle Web-controlled mode
    if (sourceBusSerial === "web-controlled") {
      setIsWebControlled(true);

      // Stop any existing mirroring
      const target: motors_mirroring.IMirroringBus = {
        type: motors_mirroring.BusType.MBT_ST3215,
        uniqueId: bus.bus.serialNumber,
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
              targetBusSerial: bus.bus?.serialNumber,
              write: {
                motorId: motor.id,
                address: 0x2a, // Target position address
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

      return;
    }

    // Disable web control if switching to other modes
    if (isWebControlled) {
      // Unfreeze all motors when leaving web-controlled mode
      if (bus.motors) {
        const commands = [];
        for (const motor of bus.motors) {
          if (motor.id !== null && motor.id !== undefined) {
            // Send command to unfreeze motor
            const command = st3215.Command.create({
              targetBusSerial: bus.bus?.serialNumber,
              write: {
                motorId: motor.id,
                address: 0x28, // Unfreeze address
                value: new Uint8Array([0]),
              },
            });
            commands.push(command);
          }
        }
        if (commands.length > 0) {
          await commandManager.sendSt3215Commands(commands);
        }
      }
    }

    setIsWebControlled(false);

    const target: motors_mirroring.IMirroringBus = {
      type: motors_mirroring.BusType.MBT_ST3215,
      uniqueId: bus.bus.serialNumber,
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
    } else {
      await commandManager.sendMirroringCommand({
        type: motors_mirroring.CommandType.CT_STOP_MIRROR,
        source: target,
      });
    }
  };

  const currentMirror = mirroringState?.mirroring?.find((m) =>
    m.targets?.some((t) => t.id?.uniqueId === bus.bus?.serialNumber),
  );

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

  return (
    <div className="border border-border-default rounded-lg bg-surface-primary/50 min-w-[300px]">
      {/* Title Bar */}
      <div className="bg-surface-secondary/50 px-4 py-2 rounded-t-lg flex flex-wrap gap-x-6 gap-y-2 border-b border-border-default items-start sm:items-center">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <span className="font-bold text-lg text-accent-data">
            #{bus.bus?.serialNumber}
          </span>
          <select
            value={
              isWebControlled
                ? "web-controlled"
                : (currentMirror?.source?.id?.uniqueId ?? "")
            }
            onChange={(e) => handleControlSourceChange(e.target.value || null)}
            className="block pl-3 pr-10 py-1 text-base border-border-subtle bg-surface-secondary text-text-primary focus:outline-none focus:ring-accent-success-deep focus:border-accent-success-deep sm:text-sm rounded-md max-w-[180px]"
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
          <select
            value={selectedVideoSourceId ?? ""}
            onChange={(e) => setSelectedVideoSourceId(e.target.value || null)}
            className="block pl-3 pr-10 py-1 text-base border-border-subtle bg-surface-secondary text-text-primary focus:outline-none focus:ring-accent-success-deep focus:border-accent-success-deep sm:text-sm rounded-md max-w-[180px]"
          >
            <option value="">No Video</option>
            {activeVideoSources.map((entry) => (
              <option
                key={`${entry.queueId}-${entry.id}`}
                value={entry.id}
                title={entry.label}
              >
                {entry.label}
              </option>
            ))}
          </select>
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
      {[6, 8].includes(bus.motors?.length || 0) ? (
        <div className="relative h-180">
          <BusWebGLRenderer
            busSerialNumber={bus.bus?.serialNumber}
            bus={bus}
            busIndex={busIndex}
            showMotorData={true}
            selectedVideoSource={selectedVideoSource}
            showCalibrateButton={true}
            needsCalibration={needsCalibration}
            isWebControlled={isWebControlled}
          />
        </div>
      ) : (
        <div className="relative h-180">
          <div className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-surface-primary/20">
            <p className="text-accent-warning mb-4 text-center">
              {(bus.motors?.length || 0) === 0 ? (
                <>No motors connected to this bus.</>
              ) : (
                <>
                  3D model visualization is only available for 6 or 8-motor
                  configurations.
                  <br />
                  This bus has {bus.motors?.length} motor
                  {bus.motors?.length === 1 ? "" : "s"}.
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
              />
            </div>
          </div>
          {selectedVideoSource && (
            <div className="absolute top-4 lg:top-auto lg:bottom-4 right-4 w-2/5 h-[200px] pointer-events-auto">
              {selectedVideoSource.kind === 'usbvideo' ? (
                <CameraViewer inferenceState={selectedVideoSource.data} />
              ) : (
                <Ov5647CameraViewer inferenceState={selectedVideoSource.data} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BusCard;
