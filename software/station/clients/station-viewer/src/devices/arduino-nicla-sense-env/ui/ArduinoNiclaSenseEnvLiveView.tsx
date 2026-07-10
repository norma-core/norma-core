import type { arduino_nicla_sense_env } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import { readArduinoNiclaSenseEnvMainValues } from '../values';

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatDecimal(value: number | null, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toFixed(decimals);
}

function formatInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toLocaleString();
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function deviceLabel(data: arduino_nicla_sense_env.IRxEnvelope): string {
  if (!data.device) {
    return 'N/A';
  }
  if (data.device.id) {
    return data.device.id;
  }
  return `bus ${data.device.i2cBus ?? 'N/A'} / ${hexByte(data.device.i2cAddress)}`;
}

export interface ArduinoNiclaSenseEnvLiveViewProps {
  data: arduino_nicla_sense_env.IRxEnvelope;
}

function ArduinoNiclaSenseEnvLiveView({ data }: ArduinoNiclaSenseEnvLiveViewProps) {
  const values = readArduinoNiclaSenseEnvMainValues(data.data);

  return (
    <DeviceWidgetShell title={deviceLabel(data)} subtitle="Arduino Sense Env" error={data.error}>
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">Temperature</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-danger">
            {formatDecimal(values.temperatureC, 1)}
            <span className="ml-1 text-sm text-text-muted">C</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">Humidity</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-info">
            {formatDecimal(values.humidityPercent, 0)}
            <span className="ml-1 text-xs text-text-muted">%</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="AQI" value={formatInteger(values.epaAqi)} tone="text-accent-warning" />
        <DeviceMetricPill label="eCO2" value={formatMeasured(values.eco2Ppm, 'ppm', 0)} tone="text-accent-success" />
      </div>
    </DeviceWidgetShell>
  );
}

export default ArduinoNiclaSenseEnvLiveView;
