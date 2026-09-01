import { live } from '@/live/define-live-module';

export default live({
  label: 'Victron SmartSolar MPPT',
  order: 4,
  layout: 'card',
  field: 'victronSmartSolar',
  loadView: () => import('./ui/VictronSmartSolarLiveView'),
});
