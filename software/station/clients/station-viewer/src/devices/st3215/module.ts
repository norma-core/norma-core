import { customLive } from '@/devices/live';
import type { BusViewerProps } from '@/st3215/BusViewer';
import { mirroringQueue } from '@/devices/mirroring/queue';
import { usbVideoQueue } from '@/devices/usbvideo/queue';
import { st3215InferenceQueue } from './queue';

export default customLive<BusViewerProps>({
  id: 'st3215',
  label: 'ST3215',
  order: 10,
  isRealtime: true,
  embedsCameraFeed: true,
  select: (frame) => {
    const inferenceState = frame.devices.entryOf(st3215InferenceQueue)?.data;
    if (!inferenceState?.buses?.length) {
      return [];
    }

    return [{
      key: 'st3215',
      props: {
        inferenceState,
        videoSources: [...frame.devices.entriesOf(usbVideoQueue)],
        mirroringState: frame.devices.entryOf(mirroringQueue)?.data.state ?? undefined,
      },
    }];
  },
  loadView: () => import('@/st3215/BusViewer'),
});
