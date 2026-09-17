// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { hikmicro } from '@/api/proto.js';
import { renderThermalFrame } from '../thermal';
import type { ThermalRenderRequest, ThermalRenderResponse } from '../thermal-worker-protocol';

it('keeps a recorded frame visible in red without live freshness, reads or delta readouts', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: ThermalRenderResponse }) => void) | null = null;
    postMessage(request: ThermalRenderRequest) {
      const result = renderThermalFrame({ deviceInfo: request.deviceInfo }, { payload: request.payload }, request.palette);
      queueMicrotask(() => this.onmessage?.({ data: { result, error: null } }));
    }
    terminate() { this.onmessage = null; }
  });
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const { default: manager } = await import('@/api/websocket');
  const read = vi.spyOn(manager.normFs, 'readLastEntry');
  const { default: View } = await import('./HikmicroThermalLiveView');
  const rootElement = document.createElement('div'); document.body.append(rootElement);
  const root = createRoot(rootElement);
  const payload = new Uint8Array(256 * 192 * 2);
  const values = new DataView(payload.buffer);
  for (let i = 0; i < payload.length / 2; i++) values.setUint16(i * 2, i, true);
  const data = hikmicro.RxEnvelope.create({ frames: { frames: [{ payload }] } });
  try {
    await act(async () => root.render(createElement(View, { data, mode: 'history' })));
    await act(async () => vi.advanceTimersByTimeAsync(6500));
    expect(putImageData).toHaveBeenCalled();
    expect(rootElement.textContent).not.toMatch(/Signal delayed|Connecting to thermal camera|Center Δ|relative to the frame average/);
    const pixels = putImageData.mock.calls.at(-1)![0].data;
    expect(pixels).toEqual(renderThermalFrame(data, { payload }, 'terminator').rgba);
    expect(read).not.toHaveBeenCalled();
    // Seeking to another recorded frame redraws it, without starting live reads.
    const nextPayload = payload.slice().reverse();
    const nextData = hikmicro.RxEnvelope.create({ frames: { frames: [{ payload: nextPayload }] } });
    await act(async () => root.render(createElement(View, { data: nextData, mode: 'history' })));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(putImageData.mock.calls.at(-1)![0].data).toEqual(renderThermalFrame(nextData, { payload: nextPayload }, 'terminator').rgba);
    expect(read).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(View, { data: nextData, mode: 'live' })));
    await act(async () => vi.advanceTimersByTimeAsync(6500));
    expect(rootElement.textContent).toContain('Signal delayed · showing last frame');
  } finally {
    await act(async () => root.unmount()); rootElement.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
