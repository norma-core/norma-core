import { drivers, victron_smartsolar_mppt } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const victronSmartSolarCodec = defineCodec<victron_smartsolar_mppt.IRxEnvelope>({
  key: 'victron-smartsolar-mppt',
  message: victron_smartsolar_mppt.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_VICTRON_SMARTSOLAR_MPPT_RX,
  cardinality: 'multiple',
});

export default victronSmartSolarCodec;
