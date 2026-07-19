import { drivers, yahboom_dogzilla_lite } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const yahboomDogzillaLiteCodec = defineCodec<yahboom_dogzilla_lite.IInferenceState>({
  key: 'yahboom_dogzilla_lite',
  message: yahboom_dogzilla_lite.InferenceState,
  queueType: drivers.QueueDataType.QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE,
  cardinality: 'single',
});

export default yahboomDogzillaLiteCodec;
