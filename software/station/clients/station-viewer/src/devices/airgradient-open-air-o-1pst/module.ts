import { live } from '@/devices/live';
import { airgradientOpenAirQueue } from './queue';

export default live({
  id: 'airgradient-open-air-o-1pst',
  label: 'AirGradient Open Air O-1PST',
  order: 3,
  slot: 'summary',
  queue: airgradientOpenAirQueue,
  loadView: () => import('./ui/AirGradientOpenAirLiveView'),
});
