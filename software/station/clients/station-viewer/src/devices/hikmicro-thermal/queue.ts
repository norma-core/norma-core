import { drivers, hikmicro } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const hikmicroThermalQueue = defineQueueAdapter<hikmicro.IRxEnvelope>({
  key: 'hikmicro-thermal',
  message: hikmicro.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_HIKMICRO_THERMAL,
  cardinality: 'multiple',
});

export default hikmicroThermalQueue;
