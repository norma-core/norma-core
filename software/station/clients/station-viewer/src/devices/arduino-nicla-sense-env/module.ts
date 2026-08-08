import { live } from '@/devices/live';

export default live({
  id: 'arduino-nicla-sense-env',
  label: 'Arduino Nicla Sense Env',
  order: 1,
  slot: 'summary',
  field: 'arduinoNiclaSenseEnv',
  loadView: () => import('./ui/ArduinoNiclaSenseEnvLiveView'),
});
