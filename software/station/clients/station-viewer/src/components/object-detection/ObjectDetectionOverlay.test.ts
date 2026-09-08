// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ObjectDetectionOverlay from './ObjectDetectionOverlay';

class TestWorker {
  static instance: TestWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  constructor() { TestWorker.instance = this; }
  postMessage() {}
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

it('holds detections between slow frames and clears them only after a new empty result', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 192, height: 256, close() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const imageRef = { current: document.createElement('canvas') };
  const frameIdRef = { current: 1 };
  const render = (sourceStale = false) => act(async () => {
    root!.render(createElement(ObjectDetectionOverlay, { imageRef, frameIdRef, fit: 'contain', sourceStale }));
  });
  await render();
  const worker = TestWorker.instance;
  await act(async () => {
    worker.respond({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(350);
    worker.respond({ type: 'result', width: 192, height: 256, boxes: [{ label: 'person', score: 0.8, x: 0.1, y: 0.1, width: 0.5, height: 0.8 }] });
  });
  expect(host.textContent).toContain('person 80%');
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(host.textContent).toContain('person 80%');
  await render(true);
  expect(host.textContent).toContain('person 80%');
  expect(host.textContent).toContain('Signal delayed');
  expect(worker.terminated).toBe(false);

  frameIdRef.current = 2;
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2350);
    worker.respond({ type: 'result', width: 192, height: 256, boxes: [] });
  });
  expect(host.textContent).not.toContain('person');
  expect(host.textContent).toContain('Objects · 0');
  await act(async () => root!.unmount());
  root = undefined;
  expect(worker.terminated).toBe(true);
});
