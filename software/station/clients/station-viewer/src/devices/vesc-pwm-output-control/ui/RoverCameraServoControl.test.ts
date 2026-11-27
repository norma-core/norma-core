// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, pwm_output } from '@/api/proto.js';

async function mountCamera(resetModules = true) {
  if (resetModules) vi.resetModules();
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
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.useRealTimers(); });

const pulse = (offset: number) => Math.round(1000 + (-71 + offset) * 1000 / 180);
const pulses = (camera: Awaited<ReturnType<typeof mountCamera>>) => camera.written.map(c => c.wave?.segments?.[0].durationUs);
const tick = async (ms = 250) => act(async () => vi.advanceTimersByTimeAsync(ms));

it('paces slider movement in 5 degree steps, retargets a slow write, and holds the final angle', async () => {
  const camera = await mountCamera();
  await camera.change(90);
  expect(pulses(camera)).toEqual([pulse(5)]);
  await camera.change(180);
  await camera.change(-56);
  await tick(1000);
  expect(camera.written).toHaveLength(1);
  await act(async () => camera.acknowledgements[0].resolve());
  await tick(249);
  expect(camera.written).toHaveLength(1);
  await tick(1);
  expect(pulses(camera)).toEqual([pulse(5), pulse(10)]);
  await act(async () => camera.acknowledgements[1].resolve());
  await tick();
  expect(pulses(camera)).toEqual([pulse(5), pulse(10), pulse(15)]);
  await act(async () => camera.acknowledgements[2].resolve());
  await tick(1000);
  expect(camera.written).toHaveLength(3);
  expect(camera.input.disabled).toBe(false);
  expect(camera.written.every(c => c.targetOutputId === 'cameras' && c.wave?.channel === 9
    && c.wave.repeatMode === pwm_output.WaveRepeatMode.WAVE_REPEAT_MODE_FOREVER)).toBe(true);
});

/* eslint-disable no-await-in-loop -- acknowledgements and simulated time must advance in order */
it('anchors every preset and return step at Under wheels, with no movement below it', async () => {
  const camera = await mountCamera();
  const preset = async (label: string) => act(async () => Array.from(camera.element.querySelectorAll('button')).find(b => b.textContent === label)!.click());
  const complete = async (start: number, count: number) => {
    for (let i = start; i < start + count; i++) {
      await act(async () => camera.acknowledgements[i].resolve());
      await tick();
    }
  };
  await preset('Reference');
  await complete(0, 14);
  expect(pulses(camera)).toEqual(Array.from({ length: 14 }, (_, i) => pulse((i + 1) * 5)));
  expect(camera.input.value).toBe('-1');
  await preset('Under wheels');
  await complete(14, 14);
  expect(pulses(camera).slice(14)).toEqual(Array.from({ length: 14 }, (_, i) => pulse(65 - i * 5)));
  expect(camera.input.value).toBe('-71');
  await camera.change(-72);
  await tick(1000);
  expect(camera.written).toHaveLength(28);
  await preset('Rear');
  await complete(28, 68);
  expect(pulses(camera).slice(28)).toEqual(Array.from({ length: 68 }, (_, i) => pulse((i + 1) * 5)));
  expect(camera.input.value).toBe('269');
  await tick(1000);
  expect(camera.written).toHaveLength(96);
});
/* eslint-enable no-await-in-loop */

it('preserves the pause when disabled and re-enabled between steps', async () => {
  const camera = await mountCamera();
  await camera.change(90);
  await act(async () => camera.acknowledgements[0].resolve());
  await camera.render(true);
  await camera.render(false);
  await camera.change(180);
  await tick(249);
  expect(camera.written).toHaveLength(1);
  await tick(1);
  expect(pulses(camera)).toEqual([5, 10].map(pulse));
});

it('waits for an old cockpit command before moving from its last acknowledged target after remount', async () => {
  const first = await mountCamera();
  await first.change(90);
  await first.unmount();
  const second = await mountCamera(false);
  await second.change(180);
  expect(second.written).toHaveLength(0);
  await act(async () => first.acknowledgements[0].resolve());
  await tick(249);
  expect(second.written).toHaveLength(0);
  await tick(1);
  expect(pulses(second)).toEqual([pulse(10)]);
  await act(async () => second.acknowledgements[0].resolve());
});

it.each(['disabled', 'unmounted'])('drops unsent steps when %s during a slow write', async boundary => {
  const camera = await mountCamera();
  await camera.change(90);
  if (boundary === 'disabled') await camera.render(true);
  else await camera.unmount();
  await act(async () => camera.acknowledgements[0].resolve());
  await tick(1000);
  expect(camera.written).toHaveLength(1);
  if (boundary === 'disabled') {
    await camera.render(false);
    await tick(1000);
    expect(camera.written).toHaveLength(1);
    await camera.change(180);
    expect(pulses(camera).at(-1)).toBe(pulse(10));
    await act(async () => camera.acknowledgements[1].resolve());
  }
});

it('cancels a scheduled step when disabled and stops the ramp on send failure', async () => {
  const camera = await mountCamera();
  await camera.change(90);
  await act(async () => camera.acknowledgements[0].resolve());
  await camera.render(true);
  await tick(1000);
  expect(camera.written).toHaveLength(1);
  await camera.render(false);
  await camera.change(90);
  await act(async () => camera.acknowledgements[1].reject(new Error('Connection lost')));
  await tick(1000);
  expect(camera.written).toHaveLength(2);
  expect(camera.element.textContent).toContain('Connection lost');
  await camera.change(90);
  expect(pulses(camera).at(-1)).toBe(pulse(10));
  await act(async () => camera.acknowledgements[2].resolve());
  expect(camera.element.textContent).not.toContain('Connection lost');
});
