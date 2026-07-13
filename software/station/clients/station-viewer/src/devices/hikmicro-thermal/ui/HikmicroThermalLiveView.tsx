import { useEffect, useMemo, useRef } from 'react';
import type { hikmicro } from '@/api/proto.js';
import {
  formatCelsius,
  hikmicroDeviceLabel,
  latestThermalFrame,
  renderThermalFrame,
} from '../thermal';

export interface HikmicroThermalLiveViewProps {
  data: hikmicro.IRxEnvelope;
}

function Metric({ label, value, tone = 'text-accent-data' }: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded border border-border-default bg-surface-primary px-2 py-1.5">
      <div className="text-[10px] uppercase text-text-label">{label}</div>
      <div className={`truncate font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function HikmicroThermalLiveView({ data }: HikmicroThermalLiveViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = latestThermalFrame(data);
  const rendered = useMemo(() => {
    if (!frame) {
      return null;
    }
    return renderThermalFrame(data, frame);
  }, [data, frame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendered) {
      return;
    }
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const imageData = ctx.createImageData(rendered.width, rendered.height);
    imageData.data.set(rendered.rgba);
    ctx.putImageData(imageData, 0, 0);
  }, [rendered]);

  const label = hikmicroDeviceLabel(data, 'HIKMICRO Thermal');
  const thermalWidth = rendered?.width ?? 256;
  const thermalHeight = rendered?.height ?? 192;

  return (
    <section className="w-fit max-w-full overflow-hidden rounded-md border border-border-default bg-surface-secondary shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border-default px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary" title={label}>
            {label}
          </div>
          <div className="truncate font-mono text-[11px] text-text-muted">
            {thermalWidth}x{thermalHeight}
            {' / '}
            {data.deviceInfo?.streamFormat?.framesPerSecond?.toFixed(1) ?? '25.0'} FPS
          </div>
        </div>
        <div className={`rounded border px-2 py-1 text-xs font-semibold ${
          rendered?.usedCalibration
            ? 'border-accent-success text-accent-success'
            : 'border-accent-warning text-accent-warning'
        }`}>
          {rendered?.usedCalibration ? 'CALIBRATED' : 'RAW'}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="relative overflow-hidden rounded bg-black">
          {rendered ? (
            <canvas
              ref={canvasRef}
              className="block select-none [image-rendering:pixelated]"
              aria-label="HIKMICRO thermal frame"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-sm text-text-secondary">
              Waiting for HIKMICRO frame data...
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Center" value={formatCelsius(rendered?.centerC ?? null)} tone="text-accent-warning" />
          <Metric label="Average" value={formatCelsius(rendered?.avgC ?? null)} />
          <Metric label="Min" value={formatCelsius(rendered?.minC ?? null)} tone="text-accent-info" />
          <Metric label="Max" value={formatCelsius(rendered?.maxC ?? null)} tone="text-accent-critical" />
        </div>

        {rendered?.error && (
          <div className="rounded border border-accent-warning bg-surface-primary p-2 text-xs text-accent-warning">
            {rendered.error}
          </div>
        )}
      </div>
    </section>
  );
}

export default HikmicroThermalLiveView;
