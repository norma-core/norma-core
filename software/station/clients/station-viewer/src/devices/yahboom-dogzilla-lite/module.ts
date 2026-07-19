import { customLive } from '@/devices/live';
import { usbVideoCodec } from '@/devices/usbvideo/codec';
import { yahboomDogzillaLiteCodec } from './codec';
import type { YahboomDogzillaLiteDeviceViewerProps } from './ui/YahboomDogzillaLiteDeviceViewer';

export default customLive<YahboomDogzillaLiteDeviceViewerProps>({
  id: 'yahboom-dogzilla-lite',
  label: 'Yahboom Dogzilla Lite',
  order: 20,
  embedsCameraFeed: true,
  select: (frame) => {
    const inferenceState = frame.devices.entryOf(yahboomDogzillaLiteCodec)?.data;
    if (!inferenceState?.devices?.length) {
      return [];
    }

    return [{
      key: 'yahboom-dogzilla-lite',
      props: {
        inferenceState,
        videoSources: [...frame.devices.entriesOf(usbVideoCodec)],
      },
    }];
  },
  loadView: () => import('./ui/YahboomDogzillaLiteDeviceViewer'),
});
