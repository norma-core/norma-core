import { customLive } from '@/devices/live';

export default customLive({
  id: 'arduino-pro-4g-gnss',
  label: 'Arduino Pro 4G GNSS',
  order: 7,
  slot: 'summary',
  loadView: () => import('./ui/ArduinoPro4gGnssLiveView'),
  // The view reads the rx queue itself (see live-store.ts), so it needs the
  // queue id alongside the sampled envelope.
  select: (frame) =>
    frame.arduinoPro4gGnss
      ? [{
          key: frame.arduinoPro4gGnss.queueId,
          props: {
            data: frame.arduinoPro4gGnss.data,
            queueId: frame.arduinoPro4gGnss.queueId,
          },
        }]
      : [],
});
