import { live } from '@/devices/live';
import { arduinoNiclaSenseEnvQueue } from './queue';

export default live({
  id: 'arduino-nicla-sense-env',
  label: 'Arduino Nicla Sense Env',
  order: 1,
  slot: 'summary',
  queue: arduinoNiclaSenseEnvQueue,
  loadView: () => import('./ui/ArduinoNiclaSenseEnvLiveView'),
});
