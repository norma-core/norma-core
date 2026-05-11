import { RefObject, useCallback, useEffect, useState } from 'react';

interface UseElementFullscreenOptions {
  closeOnEscape?: boolean;
}

interface UseElementFullscreenResult {
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

export function useElementFullscreen<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  options: UseElementFullscreenOptions = {},
): UseElementFullscreenResult {
  const { closeOnEscape = true } = options;
  const [isFullscreen, setIsFullscreen] = useState(false);

  const syncFullscreenState = useCallback(() => {
    const element = elementRef.current;
    setIsFullscreen(Boolean(element && document.fullscreenElement === element));
  }, [elementRef]);

  const exitFullscreen = useCallback(async () => {
    const element = elementRef.current;
    if (!element || document.fullscreenElement !== element) {
      return;
    }

    try {
      await document.exitFullscreen();
    } catch {
      // Ignore fullscreen errors (for example, if blocked by browser policy).
    }
  }, [elementRef]);

  const toggleFullscreen = useCallback(async () => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
        return;
      }

      await element.requestFullscreen();
    } catch {
      // Ignore fullscreen errors (for example, if blocked by browser policy).
    }
  }, [elementRef]);

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, [syncFullscreenState]);

  useEffect(() => {
    if (!closeOnEscape || !isFullscreen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      void exitFullscreen();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeOnEscape, exitFullscreen, isFullscreen]);

  return {
    isFullscreen,
    toggleFullscreen,
    exitFullscreen,
  };
}
