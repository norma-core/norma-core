import type { hikmicro } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { hikmicroThermalQueue } from './queue';
import { formatCelsius, latestThermalFrame, renderThermalFrame } from './thermal';

function Summary({ entry }: { entry: FrameEntry<hikmicro.IRxEnvelope> }) {
  const frame = latestThermalFrame(entry.data);
  const rendered = frame ? renderThermalFrame(entry.data, frame) : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className={rendered?.usedCalibration ? 'text-accent-success' : 'text-accent-warning'}>
        {rendered?.usedCalibration ? 'Calibrated' : 'Raw'}
      </span>
      {rendered && (
        <>
          <span className="text-accent-warning">Center: {formatCelsius(rendered.centerC)}</span>
          <span className="text-accent-data">Avg: {formatCelsius(rendered.avgC)}</span>
          <span className="text-accent-info">Min: {formatCelsius(rendered.minC)}</span>
          <span className="text-accent-critical">Max: {formatCelsius(rendered.maxC)}</span>
        </>
      )}
      <span className="text-text-label">Frames: {entry.data.frames?.frameCount ?? entry.data.frames?.frames?.length ?? 0}</span>
    </div>
  );
}

export default defineHistory({
  queue: hikmicroThermalQueue,
  order: 5,
  Summary,
  loadExpanded: () => import('./ui/HikmicroThermalHistoryView'),
  toJson: (data) => {
    const object = hikmicroThermalQueue.message.toObject(data, { longs: String, enums: String, bytes: String, defaults: true });
    const frames = object.frames as Record<string, unknown> | undefined;
    if (frames && Array.isArray(frames.frames)) {
      frames.frames = frames.frames.map((value, index) => {
        if (!value || typeof value !== 'object') return value;
        const frame = { ...(value as Record<string, unknown>) };
        if (typeof frame.payload === 'string' && frame.payload.length > 100) {
          frame.payload = `[thermal frame ${index + 1}: ${frame.payload.length} chars] ${frame.payload.slice(0, 50)}...`;
        }
        return frame;
      });
    }
    return object;
  },
});
