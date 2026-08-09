import { useEffect, useMemo } from 'react';
import { usbvideo } from '@/api/proto.js';
import { formatTimestamp, createJpegBlobUrl } from '@/components/history/history-utils';
import type { HistoryExpandedProps } from '@/devices/history';

export default function UsbVideoHistoryView({ entry, onImageClick }: HistoryExpandedProps<usbvideo.IRxEnvelope>) {
  const { data } = entry;
  const firstFrameData = data.frames?.framesData?.[0];
  const firstFrameUrl = useMemo(() => {
    if (!firstFrameData || firstFrameData.length === 0) {
      return null;
    }
    return createJpegBlobUrl(firstFrameData);
  }, [firstFrameData]);

  useEffect(() => {
    return () => {
      if (firstFrameUrl) {
        URL.revokeObjectURL(firstFrameUrl);
      }
    };
  }, [firstFrameUrl]);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-text-label mb-1">USB Video Envelope:</div>
        <div className="bg-surface-primary p-2 rounded text-xs space-y-1">
          <div className="text-accent-secondary">
            Type: {Object.keys(usbvideo.RxEnvelopeType)[data.type ?? 0]}
          </div>
          {data.stamp && (
            <div className="text-accent-data">
              Envelope Timestamp: {formatTimestamp(data.stamp)}
            </div>
          )}
          {data.error && (
            <div className="text-accent-critical">
              Error: {data.error}
            </div>
          )}
        </div>
      </div>

      {data.frames && data.frames.stamps && data.frames.stamps.length > 0 && (
        <div>
          <div className="text-xs text-text-label mb-1">Frame Timestamps ({data.frames.stamps.length}):</div>
          <div className="bg-surface-primary p-2 rounded text-xs max-h-32 overflow-y-auto space-y-1">
            {data.frames.stamps.map((stamp, idx) => (
              <div key={idx} className="text-accent-data font-mono">
                Frame {idx + 1}: {formatTimestamp(stamp)}
                {stamp.index && <span className="text-text-label ml-2">(idx: {stamp.index.toString()})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.frames && data.frames.framesData && data.frames.framesData.length > 0 && (
        <div>
          <div className="text-xs text-text-label mb-1">First Frame Image:</div>
          <div className="bg-surface-primary p-2 rounded">
            {firstFrameUrl ? (
              <img
                src={firstFrameUrl}
                alt="First frame"
                className="max-w-full max-h-48 object-contain rounded cursor-pointer hover:border-accent-info border border-transparent transition-colors"
                onClick={() => onImageClick(firstFrameUrl, 'First frame')}
              />
            ) : (
              <div className="text-accent-critical text-xs">Failed to load JPEG image</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
