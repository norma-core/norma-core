import { live } from '@/devices/live';
import { hikmicroThermalCodec } from './codec';

export default live({
  id: 'hikmicro-thermal',
  label: 'HIKMICRO Thermal',
  order: 26,
  slot: 'summary',
  codec: hikmicroThermalCodec,
  when: (data) => Boolean(data.frames?.frames?.length),
  loadView: () => import('./ui/HikmicroThermalLiveView'),
});
