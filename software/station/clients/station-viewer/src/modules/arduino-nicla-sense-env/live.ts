import { live } from '@/live/define-live-module';

export default live({
  label: 'Arduino Nicla Sense Env',
  order: 1,
  layout: 'card',
  field: 'arduinoNiclaSenseEnv',
  loadView: () => import('./ui/ArduinoNiclaSenseEnvLiveView'),
});
