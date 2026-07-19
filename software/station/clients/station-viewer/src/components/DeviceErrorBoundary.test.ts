// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceErrorBoundary from './DeviceErrorBoundary';

function FailingView({ shouldFail }: { shouldFail: boolean }) {
  if (shouldFail) throw new Error('broken frame');
  return createElement('div', null, 'Recovered');
}

describe('DeviceErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('retries its children after the reset key changes', async () => {
    await act(async () => {
      root.render(createElement(
        DeviceErrorBoundary,
        {
          label: 'camera',
          resetKey: 'frame-1',
          children: createElement(FailingView, { shouldFail: true }),
        },
      ));
    });
    expect(container.textContent).toContain('Failed to render camera: broken frame');

    await act(async () => {
      root.render(createElement(
        DeviceErrorBoundary,
        {
          label: 'camera',
          resetKey: 'frame-2',
          children: createElement(FailingView, { shouldFail: false }),
        },
      ));
    });
    expect(container.textContent).toBe('Recovered');
  });
});
