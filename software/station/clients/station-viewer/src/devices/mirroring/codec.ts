import { drivers, motors_mirroring } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const mirroringCodec = defineCodec<motors_mirroring.IRxEnvelope>({
  key: 'mirroring',
  message: motors_mirroring.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_MOTOR_MIRRORING_RX,
  cardinality: 'single',
});

export default mirroringCodec;
