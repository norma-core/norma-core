import type { hikmicro } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';
import HikmicroThermalLiveView from './HikmicroThermalLiveView';

export default function HikmicroThermalHistoryView({ entry }: HistoryExpandedProps<hikmicro.IRxEnvelope>) {
  return <HikmicroThermalLiveView data={entry.data} />;
}
