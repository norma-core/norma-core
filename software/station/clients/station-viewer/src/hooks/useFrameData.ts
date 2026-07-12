import { useCallback, useEffect, useRef, useState } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import type { Frame } from '@/api/frame-parser';

const DEBOUNCE_DELAY_MS = 200;

export interface UseFrameDataOptions {
  frameNumber: number | null;
  immediate?: boolean;
}

export interface UseFrameDataReturn {
  parsedFrame: Frame | null;
  isLoading: boolean;
  error: string | null;
}

export function useFrameData({
  frameNumber,
  immediate = false,
}: UseFrameDataOptions): UseFrameDataReturn {
  const [parsedFrame, setParsedFrame] = useState<Frame | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedFrameRef = useRef<Frame | null>(null);
  const requestGenerationRef = useRef(0);

  const readEntryData = useCallback(async (
    selectedFrame: number,
    generation: number,
  ) => {
    if (generation !== requestGenerationRef.current) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const entryIdBytes = new Uint8Array(Long.fromNumber(selectedFrame).toBytesLE());
      const frame = await webSocketManager.getFrame(
        entryIdBytes,
        parsedFrameRef.current ?? undefined,
      );

      if (generation !== requestGenerationRef.current) {
        return;
      }

      parsedFrameRef.current = frame;
      setParsedFrame(frame);
    } catch (err) {
      if (generation !== requestGenerationRef.current) {
        return;
      }

      console.error('Failed to parse frame:', err);
      setError(
        `Failed to parse frame: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      if (generation === requestGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;

    if (frameNumber === null) {
      setIsLoading(false);
      setError(null);
      return;
    }

    if (immediate) {
      void readEntryData(frameNumber, generation);
      return () => {
        requestGenerationRef.current += 1;
      };
    }

    const debounceTimeout = window.setTimeout(() => {
      void readEntryData(frameNumber, generation);
    }, DEBOUNCE_DELAY_MS);

    return () => {
      window.clearTimeout(debounceTimeout);
      requestGenerationRef.current += 1;
    };
  }, [frameNumber, immediate, readEntryData]);

  return {
    parsedFrame,
    isLoading,
    error,
  };
}
