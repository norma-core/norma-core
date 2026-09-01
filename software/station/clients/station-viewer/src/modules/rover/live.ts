import {
  LIVE_TRAIT_REALTIME,
  customLive,
  frameFieldClaims,
} from '@/live/define-live-module';

export default customLive({
  label: 'Rover',
  order: 29,
  layout: 'screen',
  claims: frameFieldClaims(
    'vescTrampa',
    'pwmOutputRx',
    'pwmOutputTx',
    'videoQueues',
    'victronSmartSolar',
  ),
  traits: [LIVE_TRAIT_REALTIME],
  loadView: () => import('./ui/RoverLiveView'),
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
      key: 'rover',
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
