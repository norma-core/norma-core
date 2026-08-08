import { live } from '@/devices/live';

export default live({
  id: 'vesc-trampa',
  label: 'VESC Trampa',
  order: 30,
  isRealtime: true,
  field: 'vescTrampa',
  when: (data) => Boolean(data.boards?.length),
  loadView: () => import('./ui/VescTrampaViewer'),
});
