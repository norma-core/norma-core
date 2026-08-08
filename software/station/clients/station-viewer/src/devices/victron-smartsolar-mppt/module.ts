import { live } from '@/devices/live';

export default live({
  id: 'victron-smartsolar-mppt',
  label: 'Victron SmartSolar MPPT',
  order: 4,
  slot: 'summary',
  field: 'victronSmartSolar',
  loadView: () => import('./ui/VictronSmartSolarLiveView'),
});
