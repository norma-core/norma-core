import { drivers, sysinfo } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const sysinfoQueue = defineQueueAdapter<sysinfo.IEnvelope>({
  key: 'sysinfo',
  message: sysinfo.Envelope,
  queueType: drivers.QueueDataType.QDT_SYSTEM,
  cardinality: 'single',
  matchQueue: (queueId) => queueId === 'system/rx' || queueId.endsWith('/system/rx'),
});

export default sysinfoQueue;
