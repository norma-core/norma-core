import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { LiveCameraFrame } from './live-camera-store';
import { subscribeLiveCameraFrame } from './live-camera-store';

interface CameraViewerProps {
  sourceId: string | null | undefined;
  className?: string;
  imageClassName?: string;
  overlay?: 'none' | 'fps';
  fit?: 'contain' | 'cover';
}

function toBlobPart(data: Uint8Array): BlobPart {
  if (data.buffer instanceof ArrayBuffer) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data.buffer;
    }

    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  return new Uint8Array(data).buffer;
}

const CameraViewer = memo(function CameraViewer({
  sourceId,
  className = '',
  imageClassName = '',
  overlay = 'fps',
  fit = 'contain',
}: CameraViewerProps) {
  const [fps, setFps] = useState<number>(0);
  const [hasImage, setHasImage] = useState(false);
  const hasImageRef = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const displayedUrlRef = useRef<string | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const lastFrameIndexRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const frameCount = useRef<number>(0);
  const lastFpsTime = useRef<number>(Date.now());

  const revokeUrl = (url: string | null) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  const clearImage = useCallback((updateState = true) => {
    generationRef.current++;
    const img = imageRef.current;
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
    }

    revokeUrl(pendingUrlRef.current);
    if (displayedUrlRef.current !== pendingUrlRef.current) {
      revokeUrl(displayedUrlRef.current);
    }
    pendingUrlRef.current = null;
    displayedUrlRef.current = null;
    lastFrameIndexRef.current = null;
    hasImageRef.current = false;
    frameCount.current = 0;
    lastFpsTime.current = Date.now();
    if (updateState) {
      setFps(0);
      setHasImage(false);
    }
  }, []);

  const updateImage = useCallback((frame: LiveCameraFrame) => {
    if (!frame.data || frame.data.length === 0) {
      return;
    }
    if (frame.index && frame.index === lastFrameIndexRef.current) {
      return;
    }

    const img = imageRef.current;
    if (!img) {
      return;
    }

    frameCount.current++;
    const nowFps = Date.now();
    const timeDiff = nowFps - lastFpsTime.current;

    if (timeDiff >= 1000) {
      const calculatedFps = (frameCount.current / timeDiff) * 1000;
      setFps(calculatedFps);
      frameCount.current = 0;
      lastFpsTime.current = nowFps;
    }

    const url = URL.createObjectURL(new Blob([toBlobPart(frame.data)], { type: 'image/jpeg' }));
    const previousPendingUrl = pendingUrlRef.current;
    const generation = generationRef.current;

    pendingUrlRef.current = url;
    if (previousPendingUrl && previousPendingUrl !== displayedUrlRef.current) {
      URL.revokeObjectURL(previousPendingUrl);
    }

    img.onload = () => {
      if (generationRef.current !== generation || pendingUrlRef.current !== url) {
        URL.revokeObjectURL(url);
        return;
      }

      const previousDisplayedUrl = displayedUrlRef.current;
      displayedUrlRef.current = url;
      pendingUrlRef.current = null;
      lastFrameIndexRef.current = frame.index;
      if (!hasImageRef.current) {
        hasImageRef.current = true;
        setHasImage(true);
      }

      if (previousDisplayedUrl && previousDisplayedUrl !== url) {
        URL.revokeObjectURL(previousDisplayedUrl);
      }
    };

    img.onerror = () => {
      if (pendingUrlRef.current === url) {
        pendingUrlRef.current = null;
      }
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }, []);

  useEffect(() => {
    clearImage();
    if (!sourceId) {
      return () => clearImage(false);
    }

    const unsubscribe = subscribeLiveCameraFrame(sourceId, updateImage);
    return () => {
      unsubscribe();
      clearImage(false);
    };
  }, [clearImage, sourceId, updateImage]);

  if (!sourceId) {
    return <div className="text-text-primary p-4">Waiting for USB Video data...</div>;
  }

  const fitClassName = fit === 'cover' ? 'object-cover' : 'object-contain';

  return (
    <div className={`overflow-hidden h-full ${className}`}>
      <div className="relative flex justify-center items-center h-full w-full bg-black/20">
        <img
          ref={imageRef}
          alt="USB Camera Feed"
          className={`h-full w-full ${fitClassName} ${imageClassName} ${hasImage ? '' : 'hidden'}`}
        />
        {!hasImage && (
          <div className="text-text-primary p-4">Waiting for USB Video data...</div>
        )}
        {overlay === 'fps' && (
          <div className="absolute top-0 right-0 p-2 text-right bg-surface-secondary/70 rounded-bl-lg backdrop-blur-sm">
            <span className="text-xs text-text-label">FPS: </span>
            <span className="text-xs font-mono text-accent-data">{fps.toFixed(1)}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default CameraViewer;
