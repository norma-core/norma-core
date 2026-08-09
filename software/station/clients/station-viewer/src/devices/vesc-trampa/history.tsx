import type { vesc_trampa } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { vescTrampaTxQueue } from './queue';

function Summary({ entry }: { entry: FrameEntry<vesc_trampa.ITxEnvelope> }) {
  const data = entry.data;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {data.targetBoardUuid && <span className="text-accent-danger">UUID: {Array.from(data.targetBoardUuid.slice(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join(' ')}</span>}
      {data.boardCommand && <span className="text-accent-data">Payload: {data.boardCommand.payload?.length ?? 0}b</span>}
      {data.boardCommand?.responseExpected && <span className="text-accent-success">Response</span>}
    </div>
  );
}

export default defineHistory({
  queue: vescTrampaTxQueue,
  order: 3,
  Summary,
  loadExpanded: () => import('./ui/VescTrampaTxHistoryView'),
});
