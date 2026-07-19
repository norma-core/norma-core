import { drivers, sysinfo } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const sysinfoCodec = defineCodec<sysinfo.IEnvelope>({
  key: 'sysinfo',
  message: sysinfo.Envelope,
  queueType: drivers.QueueDataType.QDT_SYSTEM,
  cardinality: 'single',
  matchQueue: (queueId) => queueId === 'system/rx' || queueId.endsWith('/system/rx'),
});

export default sysinfoCodec;
