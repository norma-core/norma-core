import { live } from '@/devices/live';
import { vescTrampaInferenceQueue } from './queue';

export default live({
  id: 'vesc-trampa',
  label: 'VESC Trampa',
  order: 30,
  isRealtime: true,
  queue: vescTrampaInferenceQueue,
  when: (data) => Boolean(data.boards?.length),
  loadView: () => import('./ui/VescTrampaViewer'),
});
