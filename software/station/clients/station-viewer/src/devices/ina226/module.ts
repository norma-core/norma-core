import { live } from '@/devices/live';

export default live({
  id: 'ina226',
  label: 'INA226',
  order: 2,
  slot: 'summary',
  field: 'ina226',
  loadView: () => import('./ui/Ina226LiveView'),
});
