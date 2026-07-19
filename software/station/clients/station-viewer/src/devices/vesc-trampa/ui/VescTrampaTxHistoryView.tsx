import type { vesc_trampa } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';

function bytesToHex(bytes?: Uint8Array | null): string {
  return bytes ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') : 'N/A';
}

export default function VescTrampaTxHistoryView({ entry }: HistoryExpandedProps<vesc_trampa.ITxEnvelope>) {
  const { data } = entry;
  return (
    <div className="space-y-2 rounded bg-surface-primary p-2 text-xs">
      <div className="text-text-label">UUID: {bytesToHex(data.targetBoardUuid)}</div>
      {data.boardCommand && (
        <div className="text-accent-data">
          Board command: {data.boardCommand.payload?.length ?? 0} bytes,
          response {data.boardCommand.responseExpected ? 'expected' : 'not expected'}
        </div>
      )}
    </div>
  );
}
