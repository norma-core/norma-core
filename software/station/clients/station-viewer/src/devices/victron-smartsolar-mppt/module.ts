import { live } from '@/devices/live';
import { victronSmartSolarQueue } from './queue';

export default live({
  id: 'victron-smartsolar-mppt',
  label: 'Victron SmartSolar MPPT',
  order: 4,
  slot: 'summary',
  queue: victronSmartSolarQueue,
  loadView: () => import('./ui/VictronSmartSolarLiveView'),
});
