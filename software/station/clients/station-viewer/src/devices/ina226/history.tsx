import { ina226 } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/codec';
import { defineHistory } from '@/devices/history';
import { ina226Codec } from './codec';
import { formatIna226Current, readIna226CurrentAmps, readIna226ShuntMillivolts } from './values';

function Summary({ entry }: { entry: FrameEntry<ina226.IRxEnvelope> }) {
  const current = readIna226CurrentAmps(entry.data.data, entry.data.device?.info?.shuntResistanceOhms);
  const shunt = readIna226ShuntMillivolts(entry.data.data);
  const signal = ina226.Ina226SignalType[entry.data.signalType ?? 0]
    ?.replace(/^INA226_/, '')
    .replace(/_/g, ' ');
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-accent-success">{signal ?? entry.data.signalType}</span>
      {entry.data.device && <span className="text-accent-info">{entry.data.device.id || `i2c-${entry.data.device.i2cBus}`}</span>}
      {current !== null
        ? <span className="text-accent-success">Current: {formatIna226Current(current).text}</span>
        : shunt !== null && <span className="text-accent-warning">Shunt: {shunt.toFixed(4)}mV</span>}
    </div>
  );
}

export default defineHistory({
  codec: ina226Codec,
  order: 9,
  Summary,
  loadExpanded: () => import('./ui/Ina226HistoryView'),
});
