import { customLive } from '@/devices/live';
import type { YahboomDogzillaLiteDeviceViewerProps } from './ui/YahboomDogzillaLiteDeviceViewer';

export default customLive<YahboomDogzillaLiteDeviceViewerProps>({
  id: 'yahboom-dogzilla-lite',
  label: 'Yahboom Dogzilla Lite',
  order: 20,
  select: (frame) => {
    const inferenceState = frame.yahboom_dogzilla_lite?.data;
    if (!inferenceState?.devices?.length) {
      return [];
    }

    return [{
      key: 'yahboom-dogzilla-lite',
      props: {
        inferenceState,
        videoSources: frame.videoQueues,
      },
    }];
  },
  loadView: () => import('./ui/YahboomDogzillaLiteDeviceViewer'),
});
