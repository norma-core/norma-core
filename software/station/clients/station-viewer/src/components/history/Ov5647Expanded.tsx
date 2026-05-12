import { ov5647 } from '../../api/proto.js';
import { formatTimestamp, createJpegBlobUrl, createCroppedJson } from './history-utils.ts';

interface Ov5647ExpandedProps {
  data: ov5647.RxEnvelope;
}

export default function Ov5647Expanded({ data }: Ov5647ExpandedProps) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-400 mb-1">OV5647 Envelope:</div>
        <div className="bg-gray-900 p-2 rounded text-xs space-y-1">
          <div className="text-purple-400">
            Type: {Object.keys(ov5647.RxEnvelopeType)[data.type ?? 0]}
          </div>
          {data.stamp && (
            <div className="text-cyan-400">
              Envelope Timestamp: {formatTimestamp(data.stamp)}
            </div>
          )}
          {data.error && (
            <div className="text-red-400">
              Error: {data.error}
            </div>
          )}
        </div>
      </div>

      {data.frames && data.frames.stamps && data.frames.stamps.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-1">Frame Timestamps ({data.frames.stamps.length}):</div>
          <div className="bg-gray-900 p-2 rounded text-xs max-h-32 overflow-y-auto space-y-1">
            {data.frames.stamps.map((stamp, idx) => {
              const stampKey = stamp.index?.toString()
                ?? `${stamp.localStampNs?.toString() ?? 'local'}-${stamp.monotonicStampNs?.toString() ?? 'mono'}-${stamp.appStartId?.toString() ?? 'app'}`;

              return (
                <div key={stampKey} className="text-cyan-400 font-mono">
                  Frame {idx + 1}: {formatTimestamp(stamp)}
                  {stamp.index && <span className="text-gray-400 ml-2">(idx: {stamp.index.toString()})</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.frames && data.frames.framesData && data.frames.framesData.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-1">First Frame Image:</div>
          <div className="bg-gray-900 p-2 rounded">
            {(() => {
              const firstFrameData = data.frames.framesData[0];
              const blobUrl = createJpegBlobUrl(firstFrameData);
              return blobUrl ? (
                <img
                  src={blobUrl}
                  alt="First frame"
                  className="max-w-full max-h-48 object-contain rounded"
                  onLoad={() => URL.revokeObjectURL(blobUrl)}
                />
              ) : (
                <div className="text-red-400 text-xs">Failed to load JPEG image</div>
              );
            })()}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs text-gray-400 mb-1">RxEnvelope JSON (cropped data):</div>
        <div className="bg-gray-900 p-2 rounded text-xs font-mono text-yellow-400 overflow-x-auto max-h-64 overflow-y-auto">
          <pre>{createCroppedJson(data)}</pre>
        </div>
      </div>
    </div>
  );
}
