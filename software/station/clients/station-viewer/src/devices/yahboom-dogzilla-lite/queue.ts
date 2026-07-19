import { drivers, yahboom_dogzilla_lite } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const yahboomDogzillaLiteQueue = defineQueueAdapter<yahboom_dogzilla_lite.IInferenceState>({
  key: 'yahboom_dogzilla_lite',
  message: yahboom_dogzilla_lite.InferenceState,
  queueType: drivers.QueueDataType.QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE,
  cardinality: 'single',
});

export default yahboomDogzillaLiteQueue;
