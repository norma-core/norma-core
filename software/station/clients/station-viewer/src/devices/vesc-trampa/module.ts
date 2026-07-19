import { live } from '@/devices/live';
import { vescTrampaInferenceCodec } from './codec';

export default live({
  id: 'vesc-trampa',
  label: 'VESC Trampa',
  order: 30,
  isRealtime: true,
  codec: vescTrampaInferenceCodec,
  when: (data) => Boolean(data.boards?.length),
  loadView: () => import('./ui/VescTrampaViewer'),
});
