import { drivers, ina226 } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const ina226Queue = defineQueueAdapter<ina226.IRxEnvelope>({
  key: 'ina226',
  message: ina226.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_INA226_RX,
  cardinality: 'multiple',
});

export default ina226Queue;
