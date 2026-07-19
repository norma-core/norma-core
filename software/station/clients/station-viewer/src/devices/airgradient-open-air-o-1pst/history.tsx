import { airgradient_open_air_o_1pst } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { airgradientOpenAirQueue } from './queue';
import { airGradientDeviceLabel, airGradientLineText, readAirGradientValues } from './values';

function Summary({ entry }: { entry: FrameEntry<airgradient_open_air_o_1pst.IRxEnvelope> }) {
  const values = readAirGradientValues(entry.data.data);
  const signal = airgradient_open_air_o_1pst.AirGradientSignalType[entry.data.signalType ?? 0]
    ?.replace(/^AIRGRADIENT_/, '')
    .replace(/_/g, ' ');
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-accent-success">{signal ?? entry.data.signalType}</span>
      {entry.data.device && <span className="text-accent-info">{airGradientDeviceLabel(entry.data.device)}</span>}
      {values.pm25 !== null && <span className="text-accent-warning">PM2.5: {values.pm25.toFixed(0)} ug/m3</span>}
      {values.co2Ppm !== null && <span className="text-accent-success">CO2: {values.co2Ppm.toFixed(0)} ppm</span>}
      {values.temperatureC !== null && <span className="text-accent-danger">Temp: {values.temperatureC.toFixed(1)}C</span>}
      {values.humidityPercent !== null && <span className="text-accent-info">RH: {values.humidityPercent.toFixed(0)}%</span>}
    </div>
  );
}

export default defineHistory({
  queue: airgradientOpenAirQueue,
  order: 10,
  Summary,
  loadExpanded: () => import('./ui/AirGradientHistoryView'),
  toJson: (data) => ({
    ...airgradientOpenAirQueue.message.toObject(data, { longs: String, enums: String, bytes: String, defaults: true }),
    data: airGradientLineText(data.data),
  }),
});
