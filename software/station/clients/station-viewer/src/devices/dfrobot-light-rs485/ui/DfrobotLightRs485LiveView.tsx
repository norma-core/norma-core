import { Link } from 'react-router-dom';
import { dfrobot_light_rs485 } from '@/api/proto.js';
import type { FrameEntry } from '@/api/frame-parser';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import {
  dfrobotModelLabel,
  dfrobotPrimaryText,
} from '../values';

const ONLINE_SIGNALS = new Set<number>([
  dfrobot_light_rs485.DfrobotSignalType.DFROBOT_CONNECTED,
  dfrobot_light_rs485.DfrobotSignalType.DFROBOT_REGISTERS_SNAPSHOT,
]);

export interface DfrobotLightRs485LiveViewProps {
  entries: FrameEntry<dfrobot_light_rs485.IRxEnvelope>[];
}

function DfrobotLightRs485LiveView({ entries }: DfrobotLightRs485LiveViewProps) {
  const sorted = [...entries].sort((a, b) => a.queueId.localeCompare(b.queueId));
  const visible = sorted.filter(
    (entry) => (entry.data.signalType ?? 0) !== dfrobot_light_rs485.DfrobotSignalType.DFROBOT_FORGOTTEN,
  );
  const firstError = visible.map((entry) => entry.data.error).find((error) => !!error);
  const onlineCount = visible.filter((entry) =>
    ONLINE_SIGNALS.has(entry.data.signalType ?? 0),
  ).length;

  return (
    <DeviceWidgetShell title="DFRobot RS485" subtitle="Modbus sensor bus" error={firstError}>
      <div className="space-y-1">
        {visible.map((entry) => {
          const data = entry.data;
          const online = ONLINE_SIGNALS.has(data.signalType ?? 0);
          const label = data.device?.id || dfrobotModelLabel(data.device?.model);
          const value = online ? dfrobotPrimaryText(data.device?.model, data.ranges) : 'offline';
          return (
            <div key={entry.queueId} className="flex items-center gap-2 text-xs">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  online ? 'bg-accent-success' : 'bg-accent-critical'
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-text-secondary" title={entry.queueId}>
                {label}
              </span>
              <span
                className={`font-mono ${online ? 'text-accent-data' : 'text-text-muted'}`}
                title={value}
              >
                {value}
              </span>
            </div>
          );
        })}
        {onlineCount === 1 && (
          <Link
            to="/dfrobot-sensor-config"
            className="block pt-1 text-xs text-accent-data hover:underline"
          >
            Configure sensor →
          </Link>
        )}
      </div>
    </DeviceWidgetShell>
  );
}

export default DfrobotLightRs485LiveView;
