import { customLive } from '@/devices/live';
import type { BusViewerProps } from '@/st3215/BusViewer';
import { mirroringCodec } from '@/devices/mirroring/codec';
import { usbVideoCodec } from '@/devices/usbvideo/codec';
import { st3215InferenceCodec } from './codec';

export default customLive<BusViewerProps>({
  id: 'st3215',
  label: 'ST3215',
  order: 10,
  isRealtime: true,
  embedsCameraFeed: true,
  select: (frame) => {
    const inferenceState = frame.devices.entryOf(st3215InferenceCodec)?.data;
    if (!inferenceState?.buses?.length) {
      return [];
    }

    return [{
      key: 'st3215',
      props: {
        inferenceState,
        videoSources: [...frame.devices.entriesOf(usbVideoCodec)],
        mirroringState: frame.devices.entryOf(mirroringCodec)?.data.state ?? undefined,
      },
    }];
  },
  loadView: () => import('@/st3215/BusViewer'),
});
