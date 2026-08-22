import { customLive } from '@/devices/live';
import type { BusViewerProps } from '@/st3215/BusViewer';

export default customLive<BusViewerProps>({
  id: 'st3215',
  label: 'ST3215',
  order: 10,
  isRealtime: true,
  ownsCameras: true,
  select: (frame) => {
    const inferenceState = frame.st3215?.data;
    if (!inferenceState?.buses?.length) {
      return [];
    }

    return [{
      key: 'st3215',
      props: {
        inferenceState,
        videoSources: frame.videoQueues,
        mirroringState: frame.mirroring?.data.state ?? undefined,
      },
    }];
  },
  loadView: () => import('@/st3215/BusViewer'),
});
