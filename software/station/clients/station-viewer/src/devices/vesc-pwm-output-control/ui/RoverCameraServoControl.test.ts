// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, pwm_output } from '@/api/proto.js';

async function mountCamera() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  const { default: manager } = await import('@/api/websocket');
  const written: pwm_output.Command[] = [];
  const acknowledgements: { resolve: () => void; reject: (error: Error) => void }[] = [];
  vi.spyOn(manager.normFs, 'enqueuePack').mockImplementation((_queue, packets) => {
    for (const packet of packets) {
      for (const command of commands.StationCommandsPack.decode(packet).commands) {
        written.push(pwm_output.Command.decode(command.body!));
      }
    }
    return new Promise((resolve, reject) => acknowledgements.push({ resolve: () => resolve([]), reject }));
  });
  const { default: Camera } = await import('./RoverCameraServoControl');
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const render = async (disabled = false) => act(async () => root.render(createElement(Camera, { expanded: true, onToggle: () => {}, disabled })));
  await render();
  const input = element.querySelector('input')!;
  const change = async (angle: number) => act(async () => {
    // Native setter avoids React's programmatic value tracker.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(angle));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const unmount = async () => { await act(async () => root.unmount()); element.remove(); };
  cleanup = unmount;
  return { written, acknowledgements, input, element, change, render, unmount };
}
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

it('sends while dragging, coalesces a slow write to the latest target, and holds the final angle', async () => {
  const camera = await mountCamera();
  await camera.change(18);
  expect(camera.written.map(c => c.wave?.segments?.[0].durationUs)).toEqual([1100]);
  expect(camera.input.disabled).toBe(false);
  await camera.change(36);
  await camera.change(90);
  expect(camera.written).toHaveLength(1);
  await act(async () => camera.acknowledgements[0].resolve());
  expect(camera.written.map(c => c.wave?.segments?.[0].durationUs)).toEqual([1100, 1500]);
  await act(async () => camera.acknowledgements[1].resolve());
  await act(async () => camera.input.dispatchEvent(new Event('pointerup', { bubbles: true })));
  expect(camera.written).toHaveLength(2);
  expect(camera.written.every(c => c.targetOutputId === 'cameras' && c.wave?.channel === 9
    && c.wave.repeatMode === pwm_output.WaveRepeatMode.WAVE_REPEAT_MODE_FOREVER)).toBe(true);
});

it.each(['disabled', 'unmounted'])('drops unsent targets when %s during a slow write', async (boundary) => {
  const camera = await mountCamera();
  await camera.change(18);
  await camera.change(90);
  if (boundary === 'disabled') await camera.render(true);
  else await camera.unmount();
  await act(async () => camera.acknowledgements[0].resolve());
  expect(camera.written).toHaveLength(1);
  if (boundary === 'disabled') {
    await camera.render(false);
    expect(camera.written).toHaveLength(1);
    await camera.change(180);
    expect(camera.written[1].wave?.segments?.[0].durationUs).toBe(2000);
    await act(async () => camera.acknowledgements[1].resolve());
  }
});

it('shows send failure and allows the next target to retry', async () => {
  const camera = await mountCamera();
  await camera.change(18);
  await act(async () => camera.acknowledgements[0].reject(new Error('Connection lost')));
  expect(camera.element.textContent).toContain('Connection lost');
  expect(camera.input.disabled).toBe(false);
  await camera.change(90);
  await act(async () => camera.acknowledgements[1].resolve());
  expect(camera.written[1].wave?.segments?.[0].durationUs).toBe(1500);
  expect(camera.element.textContent).not.toContain('Connection lost');
});
