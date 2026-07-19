import { drivers, hikmicro } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const hikmicroThermalCodec = defineCodec<hikmicro.IRxEnvelope>({
  key: 'hikmicro-thermal',
  message: hikmicro.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_HIKMICRO_THERMAL,
  cardinality: 'multiple',
});

export default hikmicroThermalCodec;
