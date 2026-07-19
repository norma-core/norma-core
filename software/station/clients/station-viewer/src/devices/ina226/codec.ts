import { drivers, ina226 } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const ina226Codec = defineCodec<ina226.IRxEnvelope>({
  key: 'ina226',
  message: ina226.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_INA226_RX,
  cardinality: 'multiple',
});

export default ina226Codec;
