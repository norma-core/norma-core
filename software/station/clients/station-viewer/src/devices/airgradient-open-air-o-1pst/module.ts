import { live } from '@/devices/live';

export default live({
  id: 'airgradient-open-air-o-1pst',
  label: 'AirGradient Open Air O-1PST',
  order: 3,
  slot: 'summary',
  field: 'airgradientOpenAir',
  loadView: () => import('./ui/AirGradientOpenAirLiveView'),
});
