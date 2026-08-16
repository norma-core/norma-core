import { live } from '@/devices/live';

export default live({
  id: 'arduino-pro-4g-gnss',
  label: 'Arduino Pro 4G GNSS',
  order: 7,
  slot: 'summary',
  field: 'arduinoPro4gGnss',
  loadView: () => import('./ui/ArduinoPro4gGnssLiveView'),
});
