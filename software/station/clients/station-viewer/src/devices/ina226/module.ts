import { live } from '@/devices/live';
import { ina226Queue } from './queue';

export default live({
  id: 'ina226',
  label: 'INA226',
  order: 2,
  slot: 'summary',
  queue: ina226Queue,
  loadView: () => import('./ui/Ina226LiveView'),
});
