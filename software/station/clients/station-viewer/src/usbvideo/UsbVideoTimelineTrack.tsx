import React, { useEffect, useRef } from 'react';
import webSocketManager from '../api/websocket';
import Long from 'long';
import { normfs, usbvideo } from '../api/proto.js';
import { isVp8 } from './vp8-chain.js';
import { decodeUsbVideoPicture, decoderRetryAt } from './vp8-frames.js';
import VideoPictureCanvas from './VideoPictureCanvas';

/**
 * A JPEG thumbnail by URL, a decoded VP8 frame drawn as is, or null for a VP8
 * frame that could not be decoded, which keeps its slot so later ones stay in place.
 */
type Thumbnail = string | ImageBitmap | null;

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
  const [imageSrcs, setImageSrcs] = React.useState<Thumbnail[]>([]);
  const [frameHeight, setFrameHeight] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);

  useEffect(() => {
    if (trackRef.current) {
      setFrameHeight(trackRef.current.offsetHeight);
    }
  }, []);

  useEffect(() => {
    // Clean up old blob URLs
    imageSrcs.forEach(releaseThumbnail);
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
        const newImageSrcs: Thumbnail[] = [];

        let cancelled = false;
        // VP8 thumbnails decode asynchronously; the chain keeps them in order.
        let shown: Promise<void> = Promise.resolve();
        const failed: Array<{ slot: number; entryId: Uint8Array; raw: usbvideo.RxEnvelope }> = [];
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        // Empty slots left while the decoder could not load are decoded once
        // more when it may load again.
        const retryFailed = () => {
          const retryAt = decoderRetryAt();
          if (failed.length === 0 || retryAt === null) {
            return;
          }
          retryTimer = setTimeout(() => {
            for (const { slot, entryId, raw } of failed.splice(0)) {
              shown = shown.then(async () => {
                if (cancelled) {
                  return;
                }
                const picture = await decodeUsbVideoPicture(webSocketManager.normFs, queueId, entryId, raw);
                if (!picture) {
                  return;
                }
                if (cancelled) {
                  picture.close();
                  return;
                }
                newImageSrcs[slot] = picture;
                setImageSrcs(prev => prev.map((thumbnail, i) => (i === slot ? picture : thumbnail)));
              });
            }
          }, Math.max(0, retryAt - Date.now()));
        };

        const onData = (event: any) => {
          const readResponse = event.detail as normfs.IReadResponse;
          if (readResponse.data && readResponse.id?.raw) {
            const entryId = readResponse.id.raw as Uint8Array;
            const raw = usbvideo.RxEnvelope.decode(readResponse.data);
            shown = shown.then(async () => {
              // An unmounted timeline stops decoding, freeing the queue's reader.
              if (cancelled) {
                return;
              }
              let thumbnail: Thumbnail;
              if (isVp8(raw)) {
                thumbnail = await decodeUsbVideoPicture(webSocketManager.normFs, queueId, entryId, raw);
                if (!thumbnail) {
                  failed.push({ slot: newImageSrcs.length, entryId, raw });
                }
              } else {
                if (!raw.frames?.framesData?.length) {
                  return;
                }
                const frameData = new Uint8Array(raw.frames.framesData[0]);
                thumbnail = URL.createObjectURL(new Blob([frameData], { type: 'image/jpeg' }));
              }
              newImageSrcs.push(thumbnail);
              if (cancelled) {
                releaseThumbnail(thumbnail);
                return;
              }
              setImageSrcs(prev => [...prev, thumbnail]);
            });
          }
        };
        
        const onEnd = () => {
            shown.finally(() => {
              setIsLoading(false);
              retryFailed();
            });
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
            cancelled = true;
            clearTimeout(retryTimer);
            cleanup();
            // Thumbnails still decoding are released when they land.
            newImageSrcs.forEach(releaseThumbnail);
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
              <ThumbnailImage key={index} thumbnail={src} size={frameHeight} />
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

function ThumbnailImage({ thumbnail, size }: { thumbnail: Thumbnail; size: number }) {
  const style = { height: `${size}px`, width: `${size}px` };
  if (thumbnail === null) {
    return <div className="bg-surface-primary" style={style} title="Frame not available" />;
  }
  return typeof thumbnail === 'string'
    ? <img src={thumbnail} className="object-cover" style={style} />
    : <VideoPictureCanvas picture={thumbnail} className="object-cover" style={style} />;
}

function releaseThumbnail(thumbnail: Thumbnail): void {
  if (thumbnail === null) {
    return;
  }
  if (typeof thumbnail === 'string') {
    URL.revokeObjectURL(thumbnail);
  } else {
    thumbnail.close();
  }
}
