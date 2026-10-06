// The package's own types are its TypeScript sources, which this project's
// strict settings would type-check; it implements the DOM WebCodecs API.
declare module 'libavjs-webcodecs-polyfill' {
  export function load(options?: { polyfill?: boolean; LibAV?: unknown; libavOptions?: Record<string, unknown> }): Promise<void>;
  export const VideoDecoder: typeof globalThis.VideoDecoder;
  export const VideoEncoder: typeof globalThis.VideoEncoder;
  export const VideoFrame: typeof globalThis.VideoFrame;
  export const EncodedVideoChunk: typeof globalThis.EncodedVideoChunk;
}
