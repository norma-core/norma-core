import { drivers, normvla } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const normvlaQueue = defineQueueAdapter<normvla.IFrame>({
  key: 'normvla',
  message: normvla.Frame,
  queueType: drivers.QueueDataType.QDT_INFERENCE_FRAMES,
  cardinality: 'single',
  matchQueue: (queueId) => queueId.endsWith('/inference/normvla'),
});

export default normvlaQueue;
