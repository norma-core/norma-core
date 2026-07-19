import { live } from '@/devices/live';
import { airgradientOpenAirCodec } from './codec';

export default live({
  id: 'airgradient-open-air-o-1pst',
  label: 'AirGradient Open Air O-1PST',
  order: 3,
  slot: 'summary',
  codec: airgradientOpenAirCodec,
  loadView: () => import('./ui/AirGradientOpenAirLiveView'),
});
