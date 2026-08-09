import { airgradient_open_air_o_1pst, drivers } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const airgradientOpenAirQueue = defineQueueAdapter<airgradient_open_air_o_1pst.IRxEnvelope>({
  key: 'airgradient-open-air-o-1pst',
  message: airgradient_open_air_o_1pst.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_AIRGRADIENT_OPEN_AIR_O_1PST_RX,
  cardinality: 'multiple',
});

export default airgradientOpenAirQueue;
