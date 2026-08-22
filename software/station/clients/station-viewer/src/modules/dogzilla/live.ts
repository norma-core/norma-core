import { customLive, frameFieldClaims } from '@/live/define-live-module';
import type { YahboomDogzillaLiteDeviceViewerProps } from './ui/YahboomDogzillaLiteDeviceViewer';

export default customLive<YahboomDogzillaLiteDeviceViewerProps>({
  label: 'Yahboom Dogzilla Lite',
  order: 20,
  claims: frameFieldClaims('yahboom_dogzilla_lite', 'videoQueues'),
  select: (frame) => {
    const inferenceState = frame.yahboom_dogzilla_lite?.data;
    if (!inferenceState?.devices?.length) {
      return [];
    }

    return [{
      key: 'dogzilla',
      props: {
        inferenceState,
        videoSources: frame.videoQueues,
      },
    }];
  },
  loadView: () => import('./ui/YahboomDogzillaLiteDeviceViewer'),
});
