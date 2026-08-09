import type { st3215 } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { st3215InferenceQueue, st3215TxQueue } from './queue';

function InferenceSummary({ entry }: { entry: FrameEntry<st3215.IInferenceState> }) {
  const motors = entry.data.buses?.reduce((total, bus) => total + (bus.motors?.length ?? 0), 0) ?? 0;
  return <div className="text-xs text-accent-data">Buses: {entry.data.buses?.length ?? 0}, motors: {motors}</div>;
}

function TxSummary({ entry }: { entry: FrameEntry<st3215.ITxEnvelope> }) {
  const data = entry.data;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {data.targetBusSerial !== undefined && <span className="text-accent-danger">Bus: {data.targetBusSerial}</span>}
      {data.write && <span className="text-accent-data">Write</span>}
      {data.regWrite && <span className="text-accent-secondary">RegWrite</span>}
      {data.action && <span className="text-accent-success">Action</span>}
    </div>
  );
}

function hexdump(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const hex = Array.from(bytes.slice(offset, offset + 16), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}`);
  }
  return lines;
}

function inferenceToJson(data: st3215.IInferenceState): unknown {
  const object = st3215InferenceQueue.message.toObject(data, { longs: String, enums: String, bytes: String, defaults: true });
  const buses = object.buses;
  if (!Array.isArray(buses)) return object;

  data.buses?.forEach((bus, busIndex) => {
    const objectBus = buses[busIndex] as Record<string, unknown> | undefined;
    const motors = objectBus?.motors;
    if (!Array.isArray(motors)) return;
    bus.motors?.forEach((motor, motorIndex) => {
      if (!motor.state?.length) return;
      const objectMotor = motors[motorIndex] as Record<string, unknown> | undefined;
      if (objectMotor) {
        objectMotor.state = { byteLength: motor.state.length, hexdump: hexdump(motor.state) };
      }
    });
  });
  return object;
}

export default [
  defineHistory({
    queue: st3215InferenceQueue,
    order: 0,
    Summary: InferenceSummary,
    loadExpanded: () => import('./ui/St3215HistoryView'),
    toJson: inferenceToJson,
  }),
  defineHistory({
    queue: st3215TxQueue,
    order: 14,
    Summary: TxSummary,
    loadExpanded: () => import('./ui/St3215TxHistoryView'),
  }),
] as const;
