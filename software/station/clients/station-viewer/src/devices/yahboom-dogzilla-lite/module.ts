import { customLive } from '@/devices/live';
import { usbVideoQueue } from '@/devices/usbvideo/queue';
import { yahboomDogzillaLiteQueue } from './queue';
import type { YahboomDogzillaLiteDeviceViewerProps } from './ui/YahboomDogzillaLiteDeviceViewer';

export default customLive<YahboomDogzillaLiteDeviceViewerProps>({
  id: 'yahboom-dogzilla-lite',
  label: 'Yahboom Dogzilla Lite',
  order: 20,
  embedsCameraFeed: true,
  select: (frame) => {
    const inferenceState = frame.devices.entryOf(yahboomDogzillaLiteQueue)?.data;
    if (!inferenceState?.devices?.length) {
      return [];
    }

    return [{
      key: 'yahboom-dogzilla-lite',
      props: {
        inferenceState,
        videoSources: [...frame.devices.entriesOf(usbVideoQueue)],
      },
    }];
  },
  loadView: () => import('./ui/YahboomDogzillaLiteDeviceViewer'),
});
