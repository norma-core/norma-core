import { customLive } from '@/devices/live';

export default customLive({
  id: 'vesc-pwm-output-control',
  label: 'Joystick',
  order: 29,
  isRealtime: true,
  ownsCameras: true,
  isImmersive: true,
  replaces: ['vesc-trampa', 'pwm-output', 'victron-smartsolar-mppt'],
  loadView: () => import('./ui/VescPwmOutputControlPanel'),
  select: (frame) => {
    const hasVesc = Boolean(frame.vescTrampa?.data.boards?.length);
    const hasPwmOutput = Boolean(
      frame.pwmOutputRx?.data.device?.id
        || frame.pwmOutputRx?.data.state?.id
        || frame.pwmOutputTx?.data.targetOutputId
        || frame.pwmOutputTx?.data.command?.targetOutputId,
    );

    if (!hasVesc || !hasPwmOutput || !frame.vescTrampa) {
      return [];
    }

    return [{
      key: 'vesc-pwm-output-control',
      props: {
        vesc: frame.vescTrampa.data,
        pwmOutputRx: frame.pwmOutputRx?.data,
        pwmOutputTx: frame.pwmOutputTx?.data,
        videoSources: frame.videoQueues,
        powerSources: frame.victronSmartSolar,
      },
    }];
  },
});
