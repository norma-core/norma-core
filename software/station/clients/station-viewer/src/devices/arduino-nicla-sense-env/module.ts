import { live } from '@/devices/live';
import { arduinoNiclaSenseEnvCodec } from './codec';

export default live({
  id: 'arduino-nicla-sense-env',
  label: 'Arduino Nicla Sense Env',
  order: 1,
  slot: 'summary',
  codec: arduinoNiclaSenseEnvCodec,
  loadView: () => import('./ui/ArduinoNiclaSenseEnvLiveView'),
});
