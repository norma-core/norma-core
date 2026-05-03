import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import type { FrameEntry } from '@/api/frame-parser';
import { serverToLocal } from '@/api/timestamp-utils';
import { dogzilla, ov5647, usbvideo } from '@/api/proto.js';
import DogzillaDesktopDashboard from '@/dogzilla/DogzillaDesktopDashboard';

interface LatencyReading {
  timestamp: number;
  latency: number;
}

interface LatencyStats {
  avg: number;
  min: number;
  max: number;
}

interface DogzillaDesktopCardProps {
  deviceState: dogzilla.InferenceState.IDeviceState;
  deviceIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
}

const DogzillaDesktopCard = memo(function DogzillaDesktopCard({
  deviceState,
  deviceIndex,
  videoSources,
  ov5647Sources
}: DogzillaDesktopCardProps) {
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState('');
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());

  const now = Date.now();
  const device = deviceState.device;
  const isConnected = deviceState.isConnected ?? false;
  const usbVideoSources = useMemo(() => videoSources ?? [], [videoSources]);

  const getMovingAverageLatency = (key: string, currentLatency: number): LatencyStats => {
    const validLatency = Math.max(0, currentLatency);
    const history = latencyHistoryRef.current.get(key) || [];

    history.push({ timestamp: now, latency: validLatency });
    const filtered = history.filter((reading) => now - reading.timestamp <= 15000);
    latencyHistoryRef.current.set(key, filtered);

    if (filtered.length === 0) {
      return { avg: validLatency, min: validLatency, max: validLatency };
    }

    const latencies = filtered.map((reading) => reading.latency);
    const sum = latencies.reduce((acc, latency) => acc + latency, 0);

    return {
      avg: sum / filtered.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies)
    };
  };

  const getStatusColor = (latency: number, hasError: boolean) => {
    if (hasError || !isConnected) {
      return 'bg-red-500';
    }
    if (latency < 100) {
      return 'bg-green-500';
    }
    if (latency < 500) {
      return 'bg-yellow-500';
    }
    if (latency < 1000) {
      return 'bg-orange-500';
    }
    return 'bg-red-500';
  };

  const getLatencyColor = (latency: number) => {
    if (latency < 100) {
      return 'text-green-400';
    }
    if (latency < 500) {
      return 'text-yellow-400';
    }
    if (latency < 1000) {
      return 'text-orange-400';
    }
    return 'text-red-400';
  };

  const adjustedStamp = deviceState.monotonicStampNs
    ? serverToLocal(Long.fromValue(deviceState.monotonicStampNs))
    : null;
  const latency = adjustedStamp ? now - adjustedStamp.toNumber() / 1e6 : 0;
  const latencyAvg = getMovingAverageLatency(`dogzilla-${deviceIndex}`, latency);

  const selectedVideoSource = (() => {
    if (selectedVideoSourceId.startsWith('usbvideo:')) {
      const id = selectedVideoSourceId.replace('usbvideo:', '');
      const source = usbVideoSources.find((entry) => entry.data.camera?.uniqueId === id)?.data;
      return source ? { kind: 'usbvideo' as const, source } : undefined;
    }

    if (selectedVideoSourceId.startsWith('ov5647:')) {
      const id = selectedVideoSourceId.replace('ov5647:', '');
      const source = ov5647Sources?.find((entry) => {
        const cameraId = entry.data.camera?.uniqueId || entry.data.camera?.id;
        return cameraId === id;
      })?.data;
      return source ? { kind: 'ov5647' as const, source } : undefined;
    }

    return undefined;
  })();

  useEffect(() => {
    if (selectedVideoSourceId) {
      return;
    }

    const options: string[] = [];
    usbVideoSources.forEach((entry) => {
      if (entry.data.camera?.uniqueId) {
        options.push(`usbvideo:${entry.data.camera.uniqueId}`);
      }
    });
    ov5647Sources?.forEach((entry) => {
      const cameraId = entry.data.camera?.uniqueId || entry.data.camera?.id;
      if (cameraId) {
        options.push(`ov5647:${cameraId}`);
      }
    });

    if (options.length === 1) {
      setSelectedVideoSourceId(options[0]);
    }
  }, [ov5647Sources, selectedVideoSourceId, usbVideoSources]);

  return (
    <div className="w-full min-w-[300px] rounded-lg border border-gray-700 bg-gray-900/50 lg:col-span-2">
      <div className="flex items-center justify-between rounded-t-lg border-b border-gray-700 bg-gray-800/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-cyan-400">
            {device?.serialNumber ? `#${device.serialNumber}` : 'Dogzilla'}
          </span>
          {!isConnected && (
            <span className="text-xs uppercase text-red-400">(Disconnected)</span>
          )}
          <select
            value={selectedVideoSourceId}
            onChange={(event) => setSelectedVideoSourceId(event.target.value)}
            className="block rounded-md border-gray-600 bg-gray-800 py-1 pl-3 pr-10 text-base text-white focus:border-green-500 focus:outline-none focus:ring-green-500 sm:text-sm"
          >
            <option value="">No Video</option>
            {usbVideoSources.map((entry) => {
              if (!entry.data.camera?.uniqueId) {
                return null;
              }
              return (
                <option key={`usbvideo-${entry.data.camera.uniqueId}`} value={`usbvideo:${entry.data.camera.uniqueId}`}>
                  USB {entry.data.camera.deviceNumber ?? 'N/A'} ({entry.data.camera.uniqueId})
                </option>
              );
            })}
            {ov5647Sources?.map((entry) => {
              const cameraId = entry.data.camera?.uniqueId || entry.data.camera?.id;
              if (!cameraId) {
                return null;
              }
              return (
                <option key={`ov5647-${cameraId}`} value={`ov5647:${cameraId}`}>
                  OV5647 {entry.data.camera?.name || entry.data.camera?.id || 'camera'} ({cameraId})
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Port:</span>
            <span className="text-cyan-400">{device?.portName || 'N/A'}</span>
          </div>
          {isConnected && (
            <span className={getLatencyColor(latency)}>
              {latencyAvg.avg < 1000
                ? `${latencyAvg.avg.toFixed(0)}ms`
                : `${(latencyAvg.avg / 1000).toFixed(1)}s`
              }
            </span>
          )}
          <span className={`h-3 w-3 rounded-full ${getStatusColor(latency, false)}`}></span>
        </div>
      </div>

      <DogzillaDesktopDashboard
        deviceState={deviceState}
        refreshToken={deviceIndex}
        selectedVideoSource={selectedVideoSource}
      />
    </div>
  );
});

export default DogzillaDesktopCard;
