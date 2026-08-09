// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceErrorBoundary from './DeviceErrorBoundary';

function FailingView({ shouldFail }: { shouldFail: boolean }) {
  if (shouldFail) throw new Error('broken frame');
  return <div>Recovered</div>;
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
      root.render(
        <DeviceErrorBoundary label="camera" resetKey="frame-1">
          <FailingView shouldFail />
        </DeviceErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('Failed to render camera: broken frame');

    await act(async () => {
      root.render(
        <DeviceErrorBoundary label="camera" resetKey="frame-2">
          <FailingView shouldFail={false} />
        </DeviceErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Recovered');
  });
});
