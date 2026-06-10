import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INFERENCE_BASE_URL,
  listInferenceModels,
  normalizeInferenceBaseUrl,
  type InferenceModel,
} from '@/api/inference';

const INFERENCE_ENDPOINT_STORAGE_KEY = 'station-viewer:inference:endpoint';
const INFERENCE_MODEL_STORAGE_KEY = 'station-viewer:inference:model';
const LEGACY_VLLM_ENDPOINT_STORAGE_KEY = 'station-viewer:vllm:endpoint';
const LEGACY_VLLM_MODEL_STORAGE_KEY = 'station-viewer:vllm:model';
const MODEL_REFRESH_DEBOUNCE_MS = 350;

function readStorageValue(
  key: string,
  fallback: string,
  legacyKey?: string,
  preserveEmpty = false,
): string {
  try {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue !== null && (preserveEmpty || storedValue.length > 0)) {
      return storedValue;
    }

    const legacyValue = legacyKey ? window.localStorage.getItem(legacyKey) : null;
    if (legacyValue !== null && (preserveEmpty || legacyValue.length > 0)) {
      return legacyValue;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function writeStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export interface UseInferenceModelsReturn {
  baseUrl: string;
  setBaseUrl: (baseUrl: string) => void;
  models: InferenceModel[];
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;
  isLoading: boolean;
  error: string | null;
  refreshModels: () => Promise<void>;
}

export function useInferenceModels(enabled = true): UseInferenceModelsReturn {
  const [baseUrl, setBaseUrlState] = useState(() =>
    readStorageValue(
      INFERENCE_ENDPOINT_STORAGE_KEY,
      DEFAULT_INFERENCE_BASE_URL,
      LEGACY_VLLM_ENDPOINT_STORAGE_KEY,
    ),
  );
  const [selectedModel, setSelectedModelState] = useState<string | null>(() => {
    const storedModel = readStorageValue(
      INFERENCE_MODEL_STORAGE_KEY,
      '',
      LEGACY_VLLM_MODEL_STORAGE_KEY,
      true,
    );
    return storedModel || null;
  });
  const [models, setModels] = useState<InferenceModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setBaseUrl = useCallback((nextBaseUrl: string) => {
    setBaseUrlState(nextBaseUrl);
    writeStorageValue(INFERENCE_ENDPOINT_STORAGE_KEY, nextBaseUrl.trim());
  }, []);

  const setSelectedModel = useCallback((model: string | null) => {
    setSelectedModelState(model);
    writeStorageValue(INFERENCE_MODEL_STORAGE_KEY, model ?? '');
  }, []);

  const refreshModels = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const nextModels = await listInferenceModels(
        normalizeInferenceBaseUrl(baseUrl),
        controller.signal,
      );
      if (requestIdRef.current !== requestId) {
        return;
      }

      setModels(nextModels);
      setSelectedModelState((currentModel) => {
        const storedModel = readStorageValue(
          INFERENCE_MODEL_STORAGE_KEY,
          '',
          LEGACY_VLLM_MODEL_STORAGE_KEY,
          true,
        );
        const storedModelExists = nextModels.some((model) => model.id === storedModel);
        const currentModelExists = nextModels.some((model) => model.id === currentModel);
        const nextModel =
          currentModelExists ? currentModel :
          storedModelExists ? storedModel :
          nextModels[0]?.id ?? null;

        writeStorageValue(INFERENCE_MODEL_STORAGE_KEY, nextModel ?? '');
        return nextModel;
      });
    } catch (err) {
      if (requestIdRef.current !== requestId || controller.signal.aborted) {
        return;
      }

      setModels([]);
      setError(err instanceof Error ? err.message : 'Inference models unavailable');
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [baseUrl]);

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort();
      setIsLoading(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void refreshModels();
    }, MODEL_REFRESH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, refreshModels]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    baseUrl,
    setBaseUrl,
    models,
    selectedModel,
    setSelectedModel,
    isLoading,
    error,
    refreshModels,
  };
}
