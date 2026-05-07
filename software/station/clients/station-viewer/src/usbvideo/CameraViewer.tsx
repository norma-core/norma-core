import { memo, useEffect, useState, useRef } from 'react';
import { usbvideo } from '../api/proto.js';
import Long from 'long';

interface CameraViewerProps {
  inferenceState: usbvideo.IRxEnvelope;
}

const CameraViewer = memo(function CameraViewer({ inferenceState }: CameraViewerProps) {
  const [fps, setFps] = useState<number>(0);
  const [imageUrl, setImageUrl] = useState<string>('');
  const previousIndexRef = useRef<Long | null>(null);
  const frameCount = useRef<number>(0);
  const lastFpsTime = useRef<number>(Date.now());

  useEffect(() => {
    if (!inferenceState || !inferenceState.frames) {
      console.log("CameraViewer: No frames", { inferenceState });
      return;
    }

    const { frames, stamp } = inferenceState;

    // Get frame data - try framesData first (single frame), then linearData (packed frames)
    const data = (frames.framesData && frames.framesData.length > 0)
      ? frames.framesData[0]
      : frames.linearData;

    if (!data || data.length === 0 || !stamp || !stamp.index) {
      console.log("CameraViewer: Missing data/stamp/index", {
        hasData: !!data,
        dataLength: data?.length,
        stamp: !!stamp,
        index: stamp?.index,
        hasFramesData: frames.framesData?.length,
        hasLinearData: !!frames.linearData
      });
      return;
    }

    const newIndex = Long.fromValue(stamp.index);

    // Only create new blob URL if frame index has changed
    if (!previousIndexRef.current || !previousIndexRef.current.equals(newIndex)) {
      // FPS calculation
      frameCount.current++;
      const nowFps = Date.now();
      const timeDiff = nowFps - lastFpsTime.current;

      if (timeDiff >= 1000) { // Update every second
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

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (!inferenceState) {
    return <div className="text-text-primary p-4">Waiting for USB Video data...</div>;
  }

  return (
    <div className="overflow-hidden h-full">
      <div className="relative flex justify-end items-center h-full">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="USB Camera Feed"
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
