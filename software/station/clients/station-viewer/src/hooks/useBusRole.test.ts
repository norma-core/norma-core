// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { st3215 } from '@/api/proto.js';
import type { BusRole } from '@/st3215/bus-role';
import { useBusRole } from './useBusRole';

const ADDR_PRESENT_VOLTAGE = 0x3e;

const motor = (decivolts: number): st3215.InferenceState.IMotorState => {
  const state = new Uint8Array(0x47);
  state[ADDR_PRESENT_VOLTAGE] = decivolts;
  return { id: 1, state };
};

let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
});

/** Mounts the hook once and returns a function that re-renders it with new motors. */
async function mountHook() {
  const seen: (BusRole | null)[] = [];
  function Probe({ motors }: { motors: st3215.InferenceState.IMotorState[] }) {
    seen.push(useBusRole(motors));
    return null;
  }
  root = createRoot(document.createElement('div'));
  const render = async (motors: st3215.InferenceState.IMotorState[]) => {
    await act(async () => root!.render(createElement(Probe, { motors })));
    return seen[seen.length - 1];
  };
  return render;
}

describe('useBusRole', () => {
  it('is unresolved until a frame carries a voltage, then keeps the role across readless frames', async () => {
    const render = await mountHook();
    expect(await render([{ id: 1 }])).toBeNull();
    expect(await render([motor(50)])).toBe('leader');
    expect(await render([{ id: 1 }])).toBe('leader');
    expect(await render([motor(120)])).toBe('follower');
    expect(await render([])).toBe('follower');
  });
});
