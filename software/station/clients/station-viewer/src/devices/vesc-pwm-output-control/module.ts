import { isRoverQueueSet } from '@/api/live-queue-policy';
import { customLive } from '@/devices/live';

export default customLive({
  id: 'vesc-pwm-output-control',
  label: 'Rover',
  order: 29,
  isRealtime: true,
  ownsCameras: true,
  isImmersive: true,
  replaces: ['vesc-trampa', 'pwm-output', 'victron-smartsolar-mppt', 'arduino-nicla-sense-me'],
  loadView: () => import('./ui/VescPwmOutputControlPanel'),
  select: (frame) => {
    const hasVesc = Boolean(frame.vescTrampa?.data.boards?.length);
    if (!hasVesc || !isRoverQueueSet(frame.availableQueues ?? []) || !frame.vescTrampa) {
      return [];
    }

    return [{
      key: 'vesc-pwm-output-control',
      props: {
        vesc: frame.vescTrampa.data,
        videoSources: frame.videoQueues,
        motionSource: frame.arduinoNiclaSenseMe?.[0],
        powerSource: frame.victronSmartSolar?.[0],
      },
    }];
  },
});
