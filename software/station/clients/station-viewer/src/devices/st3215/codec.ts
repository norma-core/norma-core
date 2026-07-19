import { drivers, st3215 } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';

export const st3215InferenceCodec = defineCodec<st3215.IInferenceState>({
  key: 'st3215',
  message: st3215.InferenceState,
  queueType: drivers.QueueDataType.QDT_ST3215_INFERENCE,
  cardinality: 'single',
});

export const st3215TxCodec = defineCodec<st3215.ITxEnvelope>({
  key: 'st3215tx',
  message: st3215.TxEnvelope,
  queueType: drivers.QueueDataType.QDT_ST3215_SERIAL_TX,
  cardinality: 'single',
});

export default [st3215InferenceCodec, st3215TxCodec] as const;
