import { live } from '@/live/define-live-module';

export default live({
  label: 'HIKMICRO Thermal',
  order: 26,
  layout: 'card',
  field: 'hikmicroThermal',
  when: (data) => Boolean(data.frames?.frames?.length),
  loadView: () => import('./ui/HikmicroThermalLiveView'),
});
