import { customLive } from '@/devices/live';
import type { HikmicroThermalLiveViewProps } from './ui/HikmicroThermalLiveView';

export default customLive<HikmicroThermalLiveViewProps>({
  id: 'hikmicro-thermal',
  label: 'HIKMICRO Thermal',
  order: 26,
  slot: 'summary',
  select: frame => (frame.hikmicroThermal ?? []).map(entry => ({
    key: entry.queueId,
    props: { data: entry.data, queueId: entry.queueId },
  })),
  loadView: () => import('./ui/HikmicroThermalLiveView'),
});
