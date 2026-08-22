import { live } from '@/live/define-live-module';

export default live({
  label: 'INA226',
  order: 2,
  layout: 'card',
  field: 'ina226',
  loadView: () => import('./ui/Ina226LiveView'),
});
