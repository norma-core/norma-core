import { Suspense, useCallback, useMemo, useState } from 'react';
import { st3215 } from '@/api/proto.js';
import DeviceErrorBoundary from '@/components/DeviceErrorBoundary';
import FullscreenImageViewer from '@/components/FullscreenImageViewer';
import ProtoJsonBlock from '@/components/history/ProtoJsonBlock';
import RawBytesExpanded from '@/components/history/RawBytesExpanded';
import type { AnyDeviceQueueAdapter, FrameEntry } from '@/devices/queue-adapter';
import { allQueueAdapters } from '@/devices/queue-adapter-registry';
import type { AnyHistoryAdapter } from '@/devices/history';

type DataTab = 'visual' | 'json' | 'raw';

export type ExpandedViewData =
  | { kind: 'decoded'; queue: AnyDeviceQueueAdapter; entry: FrameEntry<unknown>; adapter?: AnyHistoryAdapter }
  | { kind: 'raw'; data: Uint8Array };

interface ExpandedViewProps {
  value: ExpandedViewData;
}

const JSON_OPTIONS = { longs: String, enums: String, bytes: String, defaults: true };

function candidateDecodes(data: Uint8Array): Array<{ typeName: string; value: unknown }> {
  const candidates = allQueueAdapters().map((queue) => ({
    typeName: queue.key,
    decode: () => queue.message.toObject(queue.decode(data), JSON_OPTIONS),
  }));
  candidates.push({
    typeName: 'st3215.RxEnvelope',
    decode: () => st3215.RxEnvelope.toObject(st3215.RxEnvelope.decode(data), JSON_OPTIONS),
  });

  return candidates.flatMap(({ typeName, decode }) => {
    try {
      return [{ typeName, value: decode() }];
    } catch {
      return [];
    }
  });
}

function DecodedJson({ value }: { value: Extract<ExpandedViewData, { kind: 'decoded' }> }) {
  const jsonValue = useMemo(
    () => value.adapter?.toJson(value.entry.data)
      ?? value.queue.message.toObject(value.entry.data, JSON_OPTIONS),
    [value.adapter, value.entry.data, value.queue],
  );
  return <ProtoJsonBlock title={value.queue.key} value={jsonValue} />;
}

function RawCandidateJson({ data }: { data: Uint8Array }) {
  const candidates = useMemo(() => candidateDecodes(data), [data]);
  return (
    <div className="space-y-3">
      <div className="text-xs text-accent-warning">
        Candidate decodes only — protobuf payloads can decode successfully as an unrelated message.
      </div>
      {candidates.map((candidate) => (
        <ProtoJsonBlock key={candidate.typeName} title={candidate.typeName} value={candidate.value} />
      ))}
      {candidates.length === 0 && <div className="text-xs text-text-muted">No candidate decoder succeeded.</div>}
    </div>
  );
}

export default function ExpandedView({ value }: ExpandedViewProps) {
  const rawData = value.kind === 'raw' ? value.data : value.entry.rawData;
  const adapter = value.kind === 'decoded' ? value.adapter : undefined;
  const tabs: DataTab[] = [
    ...(adapter?.Expanded ? ['visual' as const] : []),
    'json',
    ...(rawData ? ['raw' as const] : []),
  ];
  const [selectedTab, setSelectedTab] = useState<DataTab | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; alt: string } | null>(null);
  const activeTab = selectedTab && tabs.includes(selectedTab) ? selectedTab : tabs[0];
  const Expanded = adapter?.Expanded;
  const closeFullscreen = useCallback(() => setFullscreenImage(null), []);

  return (
    <div className="border-t border-border-default bg-surface-secondary p-3">
      <div className="mb-3 flex gap-1 border-b border-border-default">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSelectedTab(tab)}
            className={`px-3 py-1.5 text-xs uppercase ${activeTab === tab ? 'border-b-2 border-accent-info text-accent-info' : 'text-text-muted'}`}
          >
            {tab === 'raw' ? 'Hex' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'visual' && Expanded && value.kind === 'decoded' && (
        <DeviceErrorBoundary label={value.queue.key} resetKey={value.entry}>
          <Suspense fallback={<div className="p-4 text-accent-data">Loading visual view...</div>}>
            <Expanded
              entry={value.entry}
              onImageClick={(src, alt) => setFullscreenImage({ src, alt })}
            />
          </Suspense>
        </DeviceErrorBoundary>
      )}
      {activeTab === 'json' && value.kind === 'raw' && (
        <RawCandidateJson data={value.data} />
      )}
      {activeTab === 'json' && value.kind === 'decoded' && (
        <DecodedJson value={value} />
      )}
      {activeTab === 'raw' && rawData && <RawBytesExpanded data={rawData} />}

      {fullscreenImage && (
        <FullscreenImageViewer
          src={fullscreenImage.src}
          alt={fullscreenImage.alt}
          onClose={closeFullscreen}
        />
      )}
    </div>
  );
}
