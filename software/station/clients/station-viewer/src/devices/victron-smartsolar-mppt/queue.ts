import { drivers, victron_smartsolar_mppt } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const victronSmartSolarQueue = defineQueueAdapter<victron_smartsolar_mppt.IRxEnvelope>({
  key: 'victron-smartsolar-mppt',
  message: victron_smartsolar_mppt.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_VICTRON_SMARTSOLAR_MPPT_RX,
  cardinality: 'multiple',
});

export default victronSmartSolarQueue;
