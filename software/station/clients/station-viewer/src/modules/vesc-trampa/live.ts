import { LIVE_TRAIT_REALTIME, live } from '@/live/define-live-module';

export default live({
  label: 'VESC Trampa',
  order: 30,
  traits: [LIVE_TRAIT_REALTIME],
  field: 'vescTrampa',
  when: (data) => Boolean(data.boards?.length),
  loadView: () => import('./ui/VescTrampaViewer'),
});
