import { useEffect, useMemo } from 'react';
import type { normvla } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';
import NormvlaRobotRenderer from '@/st3215/NormvlaRobotRenderer';

export default function NormvlaHistoryView({ entry, onImageClick }: HistoryExpandedProps<normvla.IFrame>) {
  const imageUrls = useMemo(() => entry.data.images?.flatMap((image, index) => {
    if (!image.jpeg?.length) return [];
    return [{ index, url: URL.createObjectURL(new Blob([new Uint8Array(image.jpeg)], { type: 'image/jpeg' })) }];
  }) ?? [], [entry.data.images]);

  useEffect(() => () => imageUrls.forEach(({ url }) => URL.revokeObjectURL(url)), [imageUrls]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {imageUrls.map(({ index, url }) => (
          <img
            key={url}
            src={url}
            alt={`NormVLA frame ${index + 1}`}
            className="max-h-64 w-full cursor-pointer rounded bg-surface-primary object-contain"
            onClick={() => onImageClick(url, `NormVLA frame ${index + 1}`)}
          />
        ))}
      </div>
      {entry.data.joints && entry.data.joints.length > 0 && (
        <div className="h-96 overflow-hidden rounded bg-surface-primary">
          <NormvlaRobotRenderer joints={entry.data.joints} />
        </div>
      )}
    </div>
  );
}
