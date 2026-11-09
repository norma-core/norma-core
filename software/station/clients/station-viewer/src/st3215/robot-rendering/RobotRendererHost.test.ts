// @vitest-environment happy-dom

import { act, createElement, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { st3215 } from '@/api/proto.js';
import type { BaseRobotRendererRef, St3215RobotRendererProps } from './types';

const rendered: St3215RobotRendererProps[] = [];

const StubRenderer = forwardRef<BaseRobotRendererRef, St3215RobotRendererProps>(function StubRenderer(props, ref) {
  useImperativeHandle(ref, () => ({ toggleRangeSpheres: () => {} }));
  rendered.push(props);
  return createElement('div', { 'data-testid': 'robot' }, props.role);
});

vi.mock('@/devices/st3215-models', () => ({
  resolveSt3215Model: () => ({ loadRenderer: async () => ({ default: StubRenderer }) }),
}));

const ADDR_PRESENT_VOLTAGE = 0x3e;

const motor = (decivolts: number): st3215.InferenceState.IMotorState => {
  const state = new Uint8Array(0x47);
  state[ADDR_PRESENT_VOLTAGE] = decivolts;
  return { id: 1, state };
};

const bus = (motors: st3215.InferenceState.IMotorState[]): st3215.InferenceState.IBusState => ({ motors });

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  rendered.length = 0;
});

async function render(motors: st3215.InferenceState.IMotorState[]) {
  const { default: RobotRendererHost } = await import('./RobotRendererHost');
  if (!root) {
    container = document.createElement('div');
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(createElement(RobotRendererHost, { busSerialNumber: 'bus-1', bus: bus(motors) }));
  });
  // Let the lazy renderer's import settle and Suspense commit it.
  await act(async () => {});
  return container;
}

describe('RobotRendererHost', () => {
  it('does not mount the device renderer until the bus role is known', async () => {
    const container = await render([{ id: 1 }]);
    expect(rendered).toHaveLength(0);
    expect(container.textContent).toContain('Detecting arm role');
    expect(container.querySelector('[data-testid="robot"]')).toBeNull();
  });

  it('mounts the device renderer with the resolved role', async () => {
    await render([{ id: 1 }]);
    const container = await render([motor(50)]);
    expect(container.querySelector('[data-testid="robot"]')?.textContent).toBe('leader');
    expect(rendered.at(-1)?.role).toBe('leader');
  });

  it('keeps the role on frames without a voltage reading', async () => {
    await render([motor(120)]);
    const container = await render([{ id: 1 }]);
    expect(container.querySelector('[data-testid="robot"]')?.textContent).toBe('follower');
  });
});
