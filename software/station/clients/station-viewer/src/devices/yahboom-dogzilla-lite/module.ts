import type { YahboomDogzillaLiteDeviceViewerProps } from './ui/YahboomDogzillaLiteDeviceViewer';
import type { DeviceModule } from '../types';

const yahboomDogzillaLiteDeviceModule = {
  id: 'yahboom-dogzilla-lite',
  label: 'Yahboom Dogzilla Lite',
  order: 20,
  live: {
    select: ({ frame, videoSources }) => {
      const inferenceState = frame.yahboom_dogzilla_lite?.data;
      if (!inferenceState?.devices?.length) {
        return [];
      }

      return [{
        key: 'yahboom-dogzilla-lite',
        props: {
          inferenceState,
          videoSources,
        },
      }];
    },
    loadView: () => import('./ui/YahboomDogzillaLiteDeviceViewer'),
  },
} satisfies DeviceModule<YahboomDogzillaLiteDeviceViewerProps>;

export default yahboomDogzillaLiteDeviceModule;
