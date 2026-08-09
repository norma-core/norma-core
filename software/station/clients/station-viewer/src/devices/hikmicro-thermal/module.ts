import { live } from '@/devices/live';
import { hikmicroThermalQueue } from './queue';

export default live({
  id: 'hikmicro-thermal',
  label: 'HIKMICRO Thermal',
  order: 26,
  slot: 'summary',
  queue: hikmicroThermalQueue,
  when: (data) => Boolean(data.frames?.frames?.length),
  loadView: () => import('./ui/HikmicroThermalLiveView'),
});
