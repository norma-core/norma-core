import { live } from '@/devices/live';

export default live({
  id: 'arduino-nicla-sense-me',
  label: 'Arduino Nicla Sense ME',
  order: 5,
  slot: 'summary',
  field: 'arduinoNiclaSenseMe',
  loadView: () => import('./ui/ArduinoNiclaSenseMeLiveView'),
});
