import { customLive, frameFieldClaims } from '@/live/define-live-module';

export default customLive({
  label: 'PWM Output',
  order: 31,
  layout: 'card',
  claims: frameFieldClaims('pwmOutputRx', 'pwmOutputTx'),
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
