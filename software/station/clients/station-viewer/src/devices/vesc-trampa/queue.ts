import { drivers, vesc_trampa } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const vescTrampaInferenceQueue = defineQueueAdapter<vesc_trampa.IInferenceState>({
  key: 'vesc-trampa',
  message: vesc_trampa.InferenceState,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_INFERENCE,
  cardinality: 'single',
});

export const vescTrampaRxQueue = defineQueueAdapter<vesc_trampa.IRxEnvelope>({
  key: 'vesc-trampa-rx',
  message: vesc_trampa.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_RX,
  cardinality: 'single',
});

export const vescTrampaTxQueue = defineQueueAdapter<vesc_trampa.ITxEnvelope>({
  key: 'vesc-trampa-tx',
  message: vesc_trampa.TxEnvelope,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_TX,
  cardinality: 'single',
});

export default [vescTrampaInferenceQueue, vescTrampaRxQueue, vescTrampaTxQueue] as const;
