import { useEffect, useRef, useState } from 'react';
import {
  analyzeCameraFrame,
  type InferenceAnalysisState,
  type InferenceClientConfig,
} from '@/api/inference';
import type { LiveCameraFrame } from '@/usbvideo/live-camera-store';
import { subscribeLiveCameraFrame } from '@/usbvideo/live-camera-store';

const ANALYSIS_INTERVAL_MS = 1_000;
const ANALYSIS_TIMEOUT_MS = 20_000;

interface UseCameraInferenceOptions {
  sourceId?: string | null;
  baseUrl: string;
  model?: string | null;
  enabled?: boolean;
}

function getAnalysisErrorMessage(err: unknown, didTimeout: boolean): string {
  if (didTimeout || (err instanceof DOMException && err.name === 'AbortError')) {
    return `Inference request timed out after ${ANALYSIS_TIMEOUT_MS / 1000}s`;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'Inference analysis failed';
}

export function useCameraInference({
  sourceId,
  baseUrl,
  model,
  enabled = true,
}: UseCameraInferenceOptions): InferenceAnalysisState {
  const [state, setState] = useState<InferenceAnalysisState>({ status: 'idle' });
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastStartedAtRef = useRef(0);

  useEffect(() => {
    generationRef.current++;
    const generation = generationRef.current;
    const controllers = new Set<AbortController>();
    let isCurrent = true;

    inFlightRef.current = false;
    lastStartedAtRef.current = 0;
    setState({ status: 'idle' });

    if (!enabled || !sourceId || !model) {
      return undefined;
    }

    const config: InferenceClientConfig = { baseUrl, model };

    const analyzeFrame = (frame: LiveCameraFrame) => {
      const now = Date.now();
      if (
        inFlightRef.current ||
        now - lastStartedAtRef.current < ANALYSIS_INTERVAL_MS ||
        !frame.data ||
        frame.data.length === 0
      ) {
        return;
      }

      inFlightRef.current = true;
      lastStartedAtRef.current = now;

      const controller = new AbortController();
      let didTimeout = false;
      const timeout = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, ANALYSIS_TIMEOUT_MS);
      controllers.add(controller);
      const startedAt = performance.now();

      setState((currentState) => ({
        status: 'running',
        text: currentState.text,
        latencyMs: currentState.latencyMs,
        updatedAt: currentState.updatedAt,
      }));

      analyzeCameraFrame(config, frame.data, { signal: controller.signal })
        .then((text) => {
          if (!isCurrent || generationRef.current !== generation) {
            return;
          }

          setState({
            status: 'ok',
            text,
            latencyMs: Math.round(performance.now() - startedAt),
            updatedAt: Date.now(),
          });
        })
        .catch((err) => {
          if (!isCurrent || generationRef.current !== generation) {
            return;
          }

          setState({
            status: 'error',
            error: getAnalysisErrorMessage(err, didTimeout),
            latencyMs: Math.round(performance.now() - startedAt),
            updatedAt: Date.now(),
          });
        })
        .finally(() => {
          window.clearTimeout(timeout);
          controllers.delete(controller);
          if (isCurrent && generationRef.current === generation) {
            inFlightRef.current = false;
          }
        });
    };

    const unsubscribe = subscribeLiveCameraFrame(sourceId, analyzeFrame);

    return () => {
      isCurrent = false;
      unsubscribe();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      inFlightRef.current = false;
    };
  }, [baseUrl, enabled, model, sourceId]);

  return state;
}
