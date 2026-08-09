import { drivers, motors_mirroring } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const mirroringQueue = defineQueueAdapter<motors_mirroring.IRxEnvelope>({
  key: 'mirroring',
  message: motors_mirroring.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_MOTOR_MIRRORING_RX,
  cardinality: 'single',
});

export default mirroringQueue;
