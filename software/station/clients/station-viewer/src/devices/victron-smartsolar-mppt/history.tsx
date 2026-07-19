import { victron_smartsolar_mppt } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { victronSmartSolarQueue } from './queue';
import {
  describeRegisterValue,
  formatRegisterHex,
  parseVeDirectHexFrame,
  parseVeDirectTextBlock,
  registerLabel,
  victronDeviceLabel,
} from './values';

function Summary({ entry }: { entry: FrameEntry<victron_smartsolar_mppt.IRxEnvelope> }) {
  const data = entry.data;
  const hexFrame = data.hexFrame?.length ? data.hexFrame : null;
  const hex = hexFrame ? parseVeDirectHexFrame(hexFrame) : null;
  const text = !hexFrame ? parseVeDirectTextBlock(data.data) : null;
  const signal = victron_smartsolar_mppt.VictronSignalType[data.signalType ?? 0]
    ?.replace(/^VICTRON_/, '')
    .replace(/_/g, ' ');
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-accent-success">{signal ?? data.signalType}</span>
      {data.device && <span className="text-accent-info">{victronDeviceLabel(data.device)}</span>}
      {hex && (
        <span className="text-accent-data">
          {formatRegisterHex(hex.register)} {registerLabel(hex.register)}: {describeRegisterValue(hex.register, hex.value)}
        </span>
      )}
      {text?.batteryVoltageV !== null && text?.batteryVoltageV !== undefined && (
        <span className="text-accent-success">Battery: {text.batteryVoltageV.toFixed(2)}V</span>
      )}
      {text?.panelPowerW !== null && text?.panelPowerW !== undefined && (
        <span className="text-accent-warning">Solar: {text.panelPowerW} W</span>
      )}
    </div>
  );
}

export default defineHistory({
  queue: victronSmartSolarQueue,
  order: 11,
  Summary,
  loadExpanded: () => import('./ui/VictronSmartSolarHistoryView'),
});
