import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions/completions.js';

export const DEFAULT_INFERENCE_BASE_URL = 'http://localhost:8000/v1';
export const DEFAULT_INFERENCE_PROMPT =
  'Briefly describe the camera scene for a robot operator. Mention visible objects, people, obstacles, and safety risks. Use at most two concise sentences.';
export const OPENAI_COMPATIBLE_FORMAT_LABEL = 'OpenAI vision';

export interface InferenceModel {
  id: string;
  ownedBy?: string;
}

export interface InferenceClientConfig {
  baseUrl: string;
  model: string;
}

export interface InferenceAnalysisState {
  status: 'idle' | 'running' | 'ok' | 'error';
  text?: string;
  error?: string;
  latencyMs?: number;
  updatedAt?: number;
}

interface AnalyzeCameraFrameOptions {
  prompt?: string;
  signal?: AbortSignal;
}

export function normalizeInferenceBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_INFERENCE_BASE_URL;
  }

  return trimmed.replace(/\/+$/, '');
}

function createOpenAICompatibleClient(baseUrl: string): OpenAI {
  return new OpenAI({
    apiKey: 'EMPTY',
    baseURL: normalizeInferenceBaseUrl(baseUrl),
    dangerouslyAllowBrowser: true,
  });
}

function uint8ArrayToBlobPart(data: Uint8Array): BlobPart {
  if (data.buffer instanceof ArrayBuffer) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data.buffer;
    }

    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  return new Uint8Array(data).buffer;
}

async function frameToDataUrl(data: Uint8Array, mimeType = 'image/jpeg'): Promise<string> {
  const blob = new Blob([uint8ArrayToBlobPart(data)], { type: mimeType });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Inference: failed to encode camera frame'));
    };
    reader.onerror = () => reject(new Error('Inference: failed to encode camera frame'));
    reader.readAsDataURL(blob);
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}

function extractChatText(response: ChatCompletion): string {
  const choice = response.choices?.[0];
  const content: unknown = choice?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (
        typeof part === 'object' && part !== null && 'text' in part
          ? part.text
          : null
      ))
      .filter((text): text is string => Boolean(text))
      .join(' ')
      .trim();
  }

  return '';
}

export async function listInferenceModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<InferenceModel[]> {
  try {
    const modelsPage = await createOpenAICompatibleClient(baseUrl).models.list({ signal });

    return modelsPage.data
      .filter((model) => typeof model.id === 'string' && model.id.length > 0)
      .map((model) => ({
        id: model.id,
        ownedBy: model.owned_by,
      }));
  } catch (err) {
    throw Object.assign(new Error(`Inference models unavailable: ${getErrorMessage(err)}`), {
      cause: err,
    });
  }
}

export async function analyzeCameraFrame(
  config: InferenceClientConfig,
  frameData: Uint8Array,
  options: AnalyzeCameraFrameOptions = {},
): Promise<string> {
  const imageUrl = await frameToDataUrl(frameData);

  try {
    const response = await createOpenAICompatibleClient(config.baseUrl).chat.completions.create({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: options.prompt ?? DEFAULT_INFERENCE_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 160,
      temperature: 0.1,
    }, {
      signal: options.signal,
    });

    const text = extractChatText(response);
    if (!text) {
      throw new Error('Inference analysis returned an empty response');
    }

    return text;
  } catch (err) {
    throw Object.assign(new Error(`Inference analysis failed: ${getErrorMessage(err)}`), {
      cause: err,
    });
  }
}
