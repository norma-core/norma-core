import type { sysinfo } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/queue-adapter';
import { defineHistory } from '@/devices/history';
import { sysinfoQueue } from './queue';

function Summary({ entry }: { entry: FrameEntry<sysinfo.IEnvelope> }) {
  const data = entry.data.data;
  const cpu = data?.cpu?.length
    ? data.cpu.reduce((sum, item) => sum + (item.usage || 0), 0) / data.cpu.length
    : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {cpu !== null && <span className="text-accent-data">CPU: {cpu.toFixed(2)}%</span>}
      {data?.memory && (
        <span className="text-accent-success">
          Mem: {(Number(data.memory.usedBytes || 0) / 1_073_741_824).toFixed(2)}/{(Number(data.memory.totalBytes || 0) / 1_073_741_824).toFixed(2)}GB
        </span>
      )}
      {data?.hostname && <span className="text-text-label">{data.hostname}</span>}
    </div>
  );
}

export default defineHistory({
  queue: sysinfoQueue,
  order: 7,
  Summary,
  loadExpanded: () => import('./ui/SysinfoHistoryView'),
});
