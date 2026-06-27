import type { ina226 } from '@/api/proto.js';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import {
  formatIna226Current,
  readIna226CurrentAmps,
  readIna226ShuntMillivolts,
} from '@/utils/ina226';

export interface Ina226LiveViewProps {
  data: ina226.IRxEnvelope;
}

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatSignedDecimal(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

function formatSignedMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${formatSignedDecimal(value, decimals)} ${unit}`;
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function deviceLabel(data: ina226.IRxEnvelope): string {
  if (!data.device) {
    return 'N/A';
  }
  if (data.device.id) {
    return data.device.id;
  }
  return `bus ${data.device.i2cBus ?? 'N/A'} / ${hexByte(data.device.i2cAddress)}`;
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0 rounded bg-surface-primary/70 px-2 py-1">
      <span className="mr-1 text-[10px] uppercase text-text-label">{label}</span>
      <span className={`font-mono text-xs font-semibold ${tone}`} title={value}>{value}</span>
    </div>
  );
}

function Ina226LiveView({ data }: Ina226LiveViewProps) {
  const shuntResistanceOhms = data.device?.info?.shuntResistanceOhms || null;
  const currentAmps = readIna226CurrentAmps(data.data, shuntResistanceOhms);
  const shuntMv = readIna226ShuntMillivolts(data.data);
  const currentDisplay = formatIna226Current(currentAmps);
  const primaryValue = currentAmps === null
    ? formatSignedDecimal(shuntMv, 4)
    : currentDisplay.value;
  const primaryUnit = currentAmps === null ? 'mV' : currentDisplay.unit;
  const primaryLabel = currentAmps === null ? 'Shunt' : 'Current';
  const primaryToneValue = currentAmps ?? shuntMv;

  return (
    <DeviceWidgetShell title={deviceLabel(data)} subtitle="INA226 Shunt Voltages" error={data.error}>
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">{primaryLabel}</div>
          <div className={`font-mono text-2xl font-semibold leading-none ${
            primaryToneValue === null
              ? 'text-text-muted'
              : primaryToneValue < 0
                ? 'text-accent-warning'
                : primaryToneValue > 0
                  ? 'text-accent-success'
                  : 'text-text-secondary'
          }`}>
            {primaryValue}
            <span className="ml-1 text-sm text-text-muted">{primaryUnit}</span>
          </div>
        </div>
      </div>
      {currentAmps !== null && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          <MetricPill label="Shunt" value={formatSignedMeasured(shuntMv, 'mV', 4)} tone="text-accent-data" />
          <MetricPill label="R" value={formatMeasured(shuntResistanceOhms, 'ohm', 4)} tone="text-accent-secondary" />
        </div>
      )}
    </DeviceWidgetShell>
  );
}

export default Ina226LiveView;
