import { live } from '@/live/define-live-module';

export default live({
  label: 'AirGradient Open Air O-1PST',
  order: 3,
  layout: 'card',
  field: 'airgradientOpenAir',
  loadView: () => import('./ui/AirGradientOpenAirLiveView'),
});
