import type { airgradient_open_air_o_1pst } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';
import { airGradientDeviceLabel, airGradientLineText, readAirGradientValues } from '../values';

export default function AirGradientHistoryView({ entry }: HistoryExpandedProps<airgradient_open_air_o_1pst.IRxEnvelope>) {
  const values = readAirGradientValues(entry.data.data);
  return (
    <div className="space-y-2 rounded bg-surface-primary p-2 text-xs">
      <div className="text-accent-data">{airGradientDeviceLabel(entry.data.device)}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <span>PM2.5: {values.pm25 ?? '--'} µg/m³</span>
        <span>CO₂: {values.co2Ppm ?? '--'} ppm</span>
        <span>Temperature: {values.temperatureC ?? '--'} C</span>
        <span>Humidity: {values.humidityPercent ?? '--'}%</span>
      </div>
      <pre className="overflow-x-auto text-accent-success">{airGradientLineText(entry.data.data)}</pre>
    </div>
  );
}
