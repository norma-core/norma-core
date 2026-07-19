import { useState } from 'react';
import ExpandedView from '@/components/history/ExpandedView';
import { formatBytes } from '@/components/history/history-utils';
import type { AnyDeviceQueueAdapter, FrameEntry } from '@/devices/queue-adapter';
import { historyAdapterFor } from '@/devices/history-registry';

export type HistoryElementData =
  | { kind: 'decoded'; queue: AnyDeviceQueueAdapter; entry: FrameEntry<unknown> }
  | { kind: 'raw'; queueId: string; ptr: Uint8Array; data: Uint8Array };

interface HistoryElementProps {
  element: HistoryElementData;
  index: number;
}

const LONG_QUEUE_ID_PREFIX = /^[a-f0-9]{32,}$/i;

function formatQueueId(queueId: string): string {
  const leadingSlash = queueId.startsWith('/');
  const segments = queueId.split('/').filter(Boolean);
  if (segments.length < 2 || !LONG_QUEUE_ID_PREFIX.test(segments[0])) return queueId;
  return `${leadingSlash ? '/' : ''}${segments.slice(1).join('/')}`;
}

export default function HistoryElement({ element, index }: HistoryElementProps) {
  const adapter = element.kind === 'decoded' ? historyAdapterFor(element.queue) : undefined;
  const [isExpanded, setIsExpanded] = useState(
    element.kind === 'decoded' ? (adapter?.defaultExpanded ?? false) : false,
  );
  const queueId = element.kind === 'decoded' ? element.entry.queueId : element.queueId;
  const ptr = element.kind === 'decoded' ? element.entry.ptr : element.ptr;
  const rawData = element.kind === 'decoded' ? element.entry.rawData : element.data;
  const Summary = adapter?.Summary;

  return (
    <div className="mb-2 overflow-hidden rounded bg-surface-secondary">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full items-center justify-between gap-3 p-2 text-left transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs text-accent-info">#{index + 1}</span>
          <span className={`text-xs text-text-label transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span className="truncate font-mono text-sm text-accent-warning">{formatQueueId(queueId)}</span>
          <span className="text-xs text-text-label">→</span>
          <span className="font-mono text-xs text-accent-success">{formatBytes(ptr)}</span>
          {element.kind === 'decoded' && <span className="font-mono text-xs text-accent-secondary">{element.queue.key}</span>}
        </div>
        <span className="shrink-0 text-xs text-text-secondary">
          {rawData ? `${rawData.length.toLocaleString()}b` : 'Parsed'}
        </span>
      </button>

      {!isExpanded && element.kind === 'decoded' && Summary && (
        <div className="px-2 pb-2">
          <Summary entry={element.entry} />
        </div>
      )}
      {!isExpanded && element.kind === 'raw' && (
        <div className="px-2 pb-2 font-mono text-xs text-accent-success">
          {formatBytes(element.data, 32)}{element.data.length > 32 ? '...' : ''}
        </div>
      )}
      {isExpanded && (
        <ExpandedView
          value={element.kind === 'decoded'
            ? { kind: 'decoded', queue: element.queue, entry: element.entry, adapter }
            : { kind: 'raw', data: element.data }}
        />
      )}
    </div>
  );
}
