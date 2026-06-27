import type { DeviceModule } from '../types';
import type { Ina226LiveViewProps } from './ui/Ina226LiveView';

const ina226Module = {
  id: 'ina226',
  label: 'INA226',
  order: 2,
  live: {
    select: ({ frame }) => (frame.ina226 ?? []).map((entry) => ({
      key: entry.queueId,
      placement: 'widget' as const,
      props: { data: entry.data },
    })),
    loadView: () => import('./ui/Ina226LiveView'),
  },
} satisfies DeviceModule<Ina226LiveViewProps>;

export default ina226Module;
