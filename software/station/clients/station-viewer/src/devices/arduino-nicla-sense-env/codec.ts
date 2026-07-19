import { arduino_nicla_sense_env, drivers } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const arduinoNiclaSenseEnvCodec = defineCodec<arduino_nicla_sense_env.IRxEnvelope>({
  key: 'arduino-nicla-sense-env',
  message: arduino_nicla_sense_env.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_ARDUINO_NICLA_SENSE_ENV_RX,
  cardinality: 'single',
});

export default arduinoNiclaSenseEnvCodec;
