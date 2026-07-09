import type { BusViewerProps } from '@/st3215/BusViewer';
import type { DeviceModule } from '@/devices/types';

const st3215DeviceModule = {
  id: 'st3215',
  label: 'ST3215',
  order: 10,
  live: {
    select: ({ frame, videoSources, mirroringState }) => {
      const inferenceState = frame.st3215?.data;
      if (!inferenceState?.buses?.length) {
        return [];
      }

      return [{
        key: 'st3215',
        tracksFrameRate: true,
        props: {
          inferenceState,
          videoSources,
          mirroringState,
        },
      }];
    },
    loadView: () => import('@/st3215/BusViewer'),
  },
} satisfies DeviceModule<BusViewerProps>;

export default st3215DeviceModule;
