import { drivers, normvla } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const normvlaCodec = defineCodec<normvla.IFrame>({
  key: 'normvla',
  message: normvla.Frame,
  queueType: drivers.QueueDataType.QDT_INFERENCE_FRAMES,
  cardinality: 'single',
  matchQueue: (queueId) => queueId.endsWith('/inference/normvla'),
});

export default normvlaCodec;
