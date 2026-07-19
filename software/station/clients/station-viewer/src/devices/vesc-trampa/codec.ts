import { drivers, vesc_trampa } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const vescTrampaInferenceCodec = defineCodec<vesc_trampa.IInferenceState>({
  key: 'vesc-trampa',
  message: vesc_trampa.InferenceState,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_INFERENCE,
  cardinality: 'single',
});

export const vescTrampaRxCodec = defineCodec<vesc_trampa.IRxEnvelope>({
  key: 'vesc-trampa-rx',
  message: vesc_trampa.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_RX,
  cardinality: 'single',
});

export const vescTrampaTxCodec = defineCodec<vesc_trampa.ITxEnvelope>({
  key: 'vesc-trampa-tx',
  message: vesc_trampa.TxEnvelope,
  queueType: drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_TX,
  cardinality: 'single',
});

export default [vescTrampaInferenceCodec, vescTrampaRxCodec, vescTrampaTxCodec] as const;
