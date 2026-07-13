import { live } from '@/devices/live';

export default live({
  id: 'hikmicro-thermal',
  label: 'HIKMICRO Thermal',
  order: 26,
  slot: 'summary',
  field: 'hikmicroThermal',
  when: (data) => Boolean(data.frames?.frames?.length),
  loadView: () => import('./ui/HikmicroThermalLiveView'),
});
