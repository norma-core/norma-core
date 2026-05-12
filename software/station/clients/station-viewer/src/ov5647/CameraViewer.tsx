import React, { useEffect, useRef, useState } from 'react';
import Long from 'long';
import { ov5647 } from '../api/proto.js';

interface CameraViewerProps {
  inferenceState: ov5647.IRxEnvelope;
}

const CameraViewer: React.FC<CameraViewerProps> = React.memo(({ inferenceState }) => {
  const [fps, setFps] = useState<number>(0);
  const [imageUrl, setImageUrl] = useState<string>('');
  const previousIndexRef = useRef<Long | null>(null);
  const frameCount = useRef<number>(0);
  const lastFpsTime = useRef<number>(Date.now());

  useEffect(() => {
    if (!inferenceState) {
      return;
    }

    if (!inferenceState.frames) {
      return;
    }

    const { frames, stamp } = inferenceState;
    const frameStamp = frames.stamps?.[0] ?? stamp;

    const data = (frames.framesData && frames.framesData.length > 0)
      ? frames.framesData[0]
      : frames.linearData;

    if (!data || !frameStamp || frameStamp.index === undefined || frameStamp.index === null) {
      return;
    }

    const newIndex = Long.fromValue(frameStamp.index);

    if (!previousIndexRef.current || !previousIndexRef.current.equals(newIndex)) {
      frameCount.current++;
      const nowFps = Date.now();
      const timeDiff = nowFps - lastFpsTime.current;

      if (timeDiff >= 1000) {
        const calculatedFps = (frameCount.current / timeDiff) * 1000;
        setFps(calculatedFps);
        frameCount.current = 0;
        lastFpsTime.current = nowFps;
      }

      const blob = new Blob([data.slice()], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setImageUrl(url);
      previousIndexRef.current = newIndex;
    }
  }, [inferenceState]);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (!inferenceState) {
    return <div className="text-text-primary p-4">Waiting for OV5647 data...</div>;
  }

  return (
    <div className="overflow-hidden h-full">
      <div className="relative flex justify-center items-center h-full">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="OV5647 Camera Feed"
            className="h-full object-contain"
          />
        )}
        <div className="absolute right-0 top-0 z-20 rounded-bl-lg bg-surface-secondary/50 p-2 text-right">
          <span className="text-xs text-text-label">FPS: </span>
          <span className="text-xs font-mono text-accent-data">{fps.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
});

export default CameraViewer;
