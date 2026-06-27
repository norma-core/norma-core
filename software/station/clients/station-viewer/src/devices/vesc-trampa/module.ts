import type { VescTrampaViewerProps } from '@/vesc-trampa/VescTrampaViewer';
import type { DeviceModule } from '../types';

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
    loadView: () => import('@/vesc-trampa/VescTrampaViewer'),
  },
} satisfies DeviceModule<VescTrampaViewerProps>;

export default vescTrampaModule;
