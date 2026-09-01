import type { airgradient_open_air_o_1pst } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import { airGradientDeviceLabel, readAirGradientValues } from '../values';

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toLocaleString();
}

export interface AirGradientOpenAirLiveViewProps {
  data: airgradient_open_air_o_1pst.IRxEnvelope;
}

function AirGradientOpenAirLiveView({ data }: AirGradientOpenAirLiveViewProps) {
  const values = readAirGradientValues(data.data);

  return (
    <DeviceWidgetShell
      title={airGradientDeviceLabel(data.device)}
      subtitle="AirGradient Open Air O-1PST"
      error={data.error}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">PM2.5</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-warning">
            {formatInteger(values.pm25)}
            <span className="ml-1 text-sm text-text-muted">ug/m3</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">CO2</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-success">
            {formatInteger(values.co2Ppm)}
            <span className="ml-1 text-xs text-text-muted">ppm</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="Temp" value={formatMeasured(values.temperatureC, 'C', 1)} tone="text-accent-danger" />
        <DeviceMetricPill label="Humidity" value={formatMeasured(values.humidityPercent, '%', 0)} tone="text-accent-info" />
        <DeviceMetricPill label="PM10" value={formatMeasured(values.pm10, 'ug/m3', 0)} tone="text-accent-data" />
        <DeviceMetricPill label="VOC" value={formatInteger(values.vocIndex)} tone="text-accent-secondary" />
        <DeviceMetricPill label="NOx" value={formatInteger(values.noxIndex)} tone="text-accent-secondary" />
      </div>
    </DeviceWidgetShell>
  );
}

export default AirGradientOpenAirLiveView;
