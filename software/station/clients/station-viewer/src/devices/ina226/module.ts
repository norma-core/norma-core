import { live } from '@/devices/live';
import { ina226Codec } from './codec';

export default live({
  id: 'ina226',
  label: 'INA226',
  order: 2,
  slot: 'summary',
  codec: ina226Codec,
  loadView: () => import('./ui/Ina226LiveView'),
});
