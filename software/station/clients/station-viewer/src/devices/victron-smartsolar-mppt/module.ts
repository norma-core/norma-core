import { live } from '@/devices/live';
import { victronSmartSolarCodec } from './codec';

export default live({
  id: 'victron-smartsolar-mppt',
  label: 'Victron SmartSolar MPPT',
  order: 4,
  slot: 'summary',
  codec: victronSmartSolarCodec,
  loadView: () => import('./ui/VictronSmartSolarLiveView'),
});
