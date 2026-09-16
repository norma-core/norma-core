// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

it('keeps steering selected when the shared PWM stream switches to cameras', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  const { default: Panel } = await import('./VescPwmOutputControlPanel');
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(Panel, { vesc: { boards: [] }, pwmOutputRx: { device: { id: 'steering' } } })));
    await act(async () => root.render(createElement(Panel, { vesc: { boards: [] }, pwmOutputRx: { device: { id: 'cameras' } }, pwmOutputTx: { targetOutputId: 'cameras' } })));
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Open rover status"]')!.click());
    const label = Array.from(element.querySelectorAll('label')).find(node => node.textContent?.includes('Steering output'))!;
    expect(label.querySelector('select')!.value).toBe('steering');
    expect(Array.from(label.querySelectorAll('option')).map(option => option.value)).not.toContain('cameras');
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
