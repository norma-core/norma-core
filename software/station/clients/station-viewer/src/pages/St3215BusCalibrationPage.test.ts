// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import St3215BusCalibrationPage from './St3215BusCalibrationPage';

const mocks = vi.hoisted(() => ({
  bus: {
    bus: { serialNumber: 'calibrated-arm' },
    motors: Array.from({ length: 6 }, () => ({
      rangeMin: 100,
      rangeMax: 900,
      rangeFreezed: true,
    })),
  },
  sendMirroringCommand: vi.fn(),
  sendSt3215Command: vi.fn(),
}));

vi.mock('@/api/websocket', () => ({
  default: {
    commands: {
      sendMirroringCommand: mocks.sendMirroringCommand,
      sendSt3215Command: mocks.sendSt3215Command,
    },
  },
}));

vi.mock('@/hooks', () => ({
  useInferenceState: () => null,
  useWakeLock: () => undefined,
}));

vi.mock('@/modules/st3215/BusWebGLRenderer', () => ({
  default: () => null,
}));

vi.mock('@/modules/st3215/model-registry', () => ({
  supportsSt3215Bus: () => true,
}));

let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('does not reset an existing calibration when the page opens', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            { pathname: '/st3215-bus-calibration', state: { bus: mocks.bus } },
          ],
        },
        createElement(St3215BusCalibrationPage),
      ),
    );
  });

  expect(mocks.sendSt3215Command).not.toHaveBeenCalled();
});
