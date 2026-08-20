import { customLive } from '@/devices/live';

export default customLive({
  id: 'pwm-output',
  label: 'PWM Output',
  order: 31,
  slot: 'summary',
  loadView: () => import('./ui/PwmOutputLiveView'),
  select: (frame) => {
    if (!frame.pwmOutputRx && !frame.pwmOutputTx) {
      return [];
    }

    return [{
      key: frame.pwmOutputRx?.queueId ?? frame.pwmOutputTx?.queueId ?? 'pwm-output',
      props: {
        rx: frame.pwmOutputRx?.data,
        tx: frame.pwmOutputTx?.data,
      },
    }];
  },
});
