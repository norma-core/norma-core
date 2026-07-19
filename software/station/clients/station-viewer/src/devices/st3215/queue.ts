import { drivers, st3215 } from '@/api/proto.js';
import { defineQueueAdapter } from '@/devices/queue-adapter';

export const st3215InferenceQueue = defineQueueAdapter<st3215.IInferenceState>({
  key: 'st3215',
  message: st3215.InferenceState,
  queueType: drivers.QueueDataType.QDT_ST3215_INFERENCE,
  cardinality: 'single',
});

export const st3215TxQueue = defineQueueAdapter<st3215.ITxEnvelope>({
  key: 'st3215tx',
  message: st3215.TxEnvelope,
  queueType: drivers.QueueDataType.QDT_ST3215_SERIAL_TX,
  cardinality: 'single',
});

export default [st3215InferenceQueue, st3215TxQueue] as const;
