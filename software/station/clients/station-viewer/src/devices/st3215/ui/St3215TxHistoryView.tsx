import type { st3215 } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';

export default function St3215TxHistoryView({ entry }: HistoryExpandedProps<st3215.ITxEnvelope>) {
  const { data } = entry;
  return (
    <div className="space-y-2 text-xs">
      <div className="text-text-label">Bus: {data.targetBusSerial ?? 'N/A'}</div>
      {data.write && (
        <div className="rounded bg-surface-primary p-2">
          <div className="mb-1 text-accent-data">Write Command:</div>
          <div className="text-text-secondary">
            Motor: {data.write.motorId}, Addr: {data.write.address}, Value: {data.write.value?.length ?? 0} bytes
          </div>
        </div>
      )}
      {data.regWrite && (
        <div className="rounded bg-surface-primary p-2">
          <div className="mb-1 text-accent-secondary">RegWrite Command:</div>
          <div className="text-text-secondary">
            Motor: {data.regWrite.motorId}, Addr: {data.regWrite.address}, Value: {data.regWrite.value?.length ?? 0} bytes
          </div>
        </div>
      )}
      {data.action && (
        <div className="rounded bg-surface-primary p-2 text-accent-success">Action: Motor {data.action.motorId}</div>
      )}
    </div>
  );
}
