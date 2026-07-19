import { arduino_nicla_sense_env } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { arduinoNiclaSenseEnvQueue } from './queue';
import { readArduinoNiclaSenseEnvMainValues } from './values';

function formatValue(number: number | null, unit = '', decimals = 2): string | null {
  return number !== null && Number.isFinite(number) ? `${number.toFixed(decimals)}${unit}` : null;
}

function Summary({ entry }: { entry: FrameEntry<arduino_nicla_sense_env.IRxEnvelope> }) {
  const values = readArduinoNiclaSenseEnvMainValues(entry.data.data);
  const signal = arduino_nicla_sense_env.ArduinoNiclaSenseEnvSignalType[entry.data.signalType ?? 0]
    ?.replace(/^ARDUINO_NICLA_SENSE_ENV_/, '')
    .replace(/_/g, ' ');
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-accent-success">{signal ?? entry.data.signalType}</span>
      {entry.data.device && <span className="text-accent-info">{entry.data.device.id || `i2c-${entry.data.device.i2cBus}`}</span>}
      {formatValue(values.temperatureC, 'C') && <span className="text-accent-danger">Temp: {formatValue(values.temperatureC, 'C')}</span>}
      {formatValue(values.humidityPercent, '%') && <span className="text-accent-info">RH: {formatValue(values.humidityPercent, '%')}</span>}
      {values.epaAqi !== null && <span className="text-accent-warning">AQI: {values.epaAqi}</span>}
      {formatValue(values.iaq) && <span className="text-accent-secondary">IAQ: {formatValue(values.iaq)}</span>}
      {formatValue(values.tvocMgM3, 'mg/m^3') && <span className="text-accent-data">TVOC: {formatValue(values.tvocMgM3, 'mg/m^3')}</span>}
      {formatValue(values.eco2Ppm, 'ppm') && <span className="text-accent-success">eCO2: {formatValue(values.eco2Ppm, 'ppm')}</span>}
    </div>
  );
}

export default defineHistory({
  queue: arduinoNiclaSenseEnvQueue,
  order: 8,
  Summary,
  loadExpanded: () => import('./ui/ArduinoNiclaSenseEnvHistoryView'),
});
