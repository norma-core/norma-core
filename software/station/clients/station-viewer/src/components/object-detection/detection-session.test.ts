import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DetectionSession } from './detection-session';

class TestWorker {
  static instance: TestWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: unknown[] = [];
  terminated = false;
  constructor() { TestWorker.instance = this; }
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

let session: DetectionSession;
const image = { complete: true, naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => { session?.dispose(); vi.useRealTimers(); });

it('limits inference to fresh frames at three per second with no concurrent captures', async () => {
  let resolveCapture!: (bitmap: ImageBitmap) => void;
  const capture = vi.fn(() => new Promise<ImageBitmap>(resolve => { resolveCapture = resolve; }));
  vi.stubGlobal('createImageBitmap', capture);
  session = new DetectionSession(() => {}, () => {});
  const worker = TestWorker.instance;
  worker.respond({ type: 'ready' });
  const first = session.detect(image, 'a');
  await session.detect(image, 'b');
  expect(capture).toHaveBeenCalledTimes(1);
  resolveCapture({ width: 320, height: 240, close() {} } as ImageBitmap);
  await first;
  worker.respond({ type: 'result', boxes: [], width: 320, height: 240 });
  await session.detect(image, 'b');
  expect(capture).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(400);
  await session.detect(image, 'a');
  expect(capture).toHaveBeenCalledTimes(1);
  const next = session.detect(image, 'c');
  expect(capture).toHaveBeenCalledTimes(2);
  resolveCapture({ width: 320, height: 240, close() {} } as ImageBitmap);
  await next;
});

it('captures fresh canvas frames without waiting for image loading metadata', async () => {
  const canvas = { width: 256, height: 192 } as HTMLCanvasElement;
  const capture = vi.fn(async () => ({ width: 256, height: 192, close() {} }));
  vi.stubGlobal('createImageBitmap', capture);
  const results = vi.fn();
  session = new DetectionSession(results, () => {});
  const worker = TestWorker.instance;
  worker.respond({ type: 'ready' });
  await session.detect(canvas, '1');
  expect(capture).toHaveBeenCalledWith(canvas, { resizeWidth: 256, resizeHeight: 192 });
  worker.respond({ type: 'result', boxes: [], width: 256, height: 192 });
  expect(results).toHaveBeenCalledWith({ type: 'result', boxes: [], width: 256, height: 192 });
  vi.advanceTimersByTime(400);
  await session.detect(canvas, '1');
  expect(capture).toHaveBeenCalledTimes(1);
});

it('closes a late bitmap after disposal and never posts it to a retired worker', async () => {
  let resolveCapture!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal('createImageBitmap', () => new Promise<ImageBitmap>(resolve => { resolveCapture = resolve; }));
  const results = vi.fn();
  session = new DetectionSession(results, () => {});
  const worker = TestWorker.instance;
  worker.respond({ type: 'ready' });
  const pending = session.detect(image, 'a');
  session.dispose();
  const close = vi.fn();
  resolveCapture({ close } as unknown as ImageBitmap);
  await pending;
  expect(close).toHaveBeenCalledOnce();
  expect(worker.messages).toHaveLength(0);
  expect(worker.terminated).toBe(true);
  expect(results).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops a hung inference and ignores late results', async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 320, height: 240, close() {} }));
  const results = vi.fn();
  const states = vi.fn();
  session = new DetectionSession(results, states);
  const worker = TestWorker.instance;
  worker.respond({ type: 'ready' });
  await session.detect(image, 'a');
  const late = worker.onmessage!;
  vi.advanceTimersByTime(10000);
  late({ data: { type: 'result', boxes: [], width: 320, height: 240 } } as MessageEvent);
  expect(worker.terminated).toBe(true);
  expect(states).toHaveBeenLastCalledWith('error');
  expect(results).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
