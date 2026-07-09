import type { DeviceModule } from '@/devices/types';
import type { VescTrampaViewerProps } from './ui/VescTrampaViewer';

const vescTrampaModule = {
  id: 'vesc-trampa',
  label: 'VESC Trampa',
  order: 30,
  live: {
    select: ({ frame }) => {
      const inferenceState = frame.vescTrampa?.data;
      if (!inferenceState?.boards?.length) {
        return [];
      }

      return [{
        key: 'vesc-trampa',
        tracksFrameRate: true,
        props: { inferenceState },
      }];
    },
    loadView: () => import('./ui/VescTrampaViewer'),
  },
} satisfies DeviceModule<VescTrampaViewerProps>;

export default vescTrampaModule;
