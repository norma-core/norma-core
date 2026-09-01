import React, { useEffect, useRef } from 'react';
import webSocketManager from '@/api/websocket';
import Long from 'long';
import { normfs, usbvideo } from '@/api/proto.js';

export interface FrameRange {
  min: number;
  max: number;
}

interface UsbVideoTimelineTrackProps {
  queueId: string;
  currentFrame: number;
  minFrame: number;
  maxFrame: number;
  disabledBeforeFrame?: number;
  height?: string;
  isFirst?: boolean;
  isLast?: boolean;
  queueFirstId?: Uint8Array | null;
  queueLastId?: Uint8Array | null;
}

const UsbVideoTimelineTrack: React.FC<UsbVideoTimelineTrackProps> = ({
  queueId,
  minFrame,
  maxFrame,
  disabledBeforeFrame,
  height = 'h-12',
  isFirst,
  isLast,
  queueFirstId,
  queueLastId,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const totalFrames = maxFrame - minFrame + 1;
  const [imageSrcs, setImageSrcs] = React.useState<string[]>([]);
  const [frameHeight, setFrameHeight] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);

  useEffect(() => {
    if (trackRef.current) {
      setFrameHeight(trackRef.current.offsetHeight);
    }
  }, []);

  useEffect(() => {
    // Clean up old blob URLs
    imageSrcs.forEach(url => URL.revokeObjectURL(url));
    setImageSrcs([]);

    if (!queueFirstId) {
      queueFirstId = new Uint8Array([]);
    }

    console.log(`Loading frames for queue ${queueId} from ${queueFirstId ? Long.fromBytesLE(Array.from(queueFirstId)).toNumber() : 'N/A'} to ${queueLastId ? Long.fromBytesLE(Array.from(queueLastId)).toNumber() : 'N/A'}`);

    if (trackRef.current && queueFirstId && queueLastId && frameHeight > 0) {
      const trackWidth = trackRef.current.offsetWidth;
      const disabledPercent = disabledBeforeFrame ? frameToPercent(disabledBeforeFrame) : 0;
      const availableWidth = trackWidth * (1 - disabledPercent / 100);
      const numFramesToDisplay = Math.floor(availableWidth / frameHeight);

      const firstIdNum = Long.fromBytesLE(Array.from(queueFirstId)).toNumber();
      const lastIdNum = Long.fromBytesLE(Array.from(queueLastId)).toNumber();
      const totalQueueFrames = lastIdNum - firstIdNum + 1;
      
      if (numFramesToDisplay > 0 && totalQueueFrames > 0) {
        setIsLoading(true);
        const step = Math.max(1, Math.floor(totalQueueFrames / numFramesToDisplay));

        const stream = webSocketManager.normFs.read(queueId, queueFirstId, normfs.OffsetType.OT_ABSOLUTE, numFramesToDisplay, step);
        const newImageSrcs: string[] = [];

        const onData = (event: any) => {
          const readResponse = event.detail as normfs.IReadResponse;
          if (readResponse.data) {
            const envelope = usbvideo.RxEnvelope.decode(readResponse.data);
            if (envelope.frames && envelope.frames.framesData && envelope.frames.framesData.length > 0) {
              const frameData = new Uint8Array(envelope.frames.framesData[0]);
              const blob = new Blob([frameData], { type: 'image/jpeg' });
              const url = URL.createObjectURL(blob);
              newImageSrcs.push(url);
              setImageSrcs(prev => [...prev, url]);
            }
          }
        };
        
        const onEnd = () => {
            setIsLoading(false);
            cleanup();
        };

        const onError = (err: any) => {
            console.error('Error reading stream:', err);
            setIsLoading(false);
            cleanup();
        };

        const cleanup = () => {
            stream.removeEventListener('data', onData);
            stream.removeEventListener('end', onEnd);
            stream.removeEventListener('error', onError);
        };

        stream.addEventListener('data', onData);
        stream.addEventListener('end', onEnd);
        stream.addEventListener('error', onError);

        return () => {
            cleanup();
            newImageSrcs.forEach(url => URL.revokeObjectURL(url));
        };
      }
    }
  }, [queueId, queueFirstId, queueLastId, frameHeight, disabledBeforeFrame, minFrame, maxFrame]);

  const frameToPercent = (frame: number) => {
    if (totalFrames <= 1) return 0;
    return (Math.max(0, frame - minFrame) / (totalFrames - 1)) * 100;
  };

  const disabledWidth = disabledBeforeFrame ? frameToPercent(disabledBeforeFrame) : 0;

  return (
    <div ref={trackRef} className={`w-full ${height} bg-surface-tertiary relative cursor-pointer ${isFirst ? 'rounded-t' : ''} ${isLast ? 'rounded-b' : ''}`}>
      <div className="absolute top-0 h-full flex items-center justify-center pointer-events-none" style={{ left: `${disabledWidth}%`, right: '0' }}>
        {isLoading && <div className="text-text-primary">Loading frames...</div>}
      </div>
      <div className="absolute top-0 h-full flex overflow-hidden pointer-events-none" style={{ left: `${disabledWidth}%`, right: '0' }}>
          {imageSrcs.map((src, index) => (
              <img key={index} src={src} className="object-cover" style={{ height: `${frameHeight}px`, width: `${frameHeight}px` }} />
          ))}
      </div>
      {disabledWidth > 0 && (
        <div
          className={`absolute top-0 left-0 h-full bg-surface-primary/50 ${isFirst ? 'rounded-tl' : ''} ${isLast ? 'rounded-bl' : ''}`}
          style={{ width: `${disabledWidth}%` }}
        ></div>
      )}
    </div>
  );
};

export default UsbVideoTimelineTrack;
