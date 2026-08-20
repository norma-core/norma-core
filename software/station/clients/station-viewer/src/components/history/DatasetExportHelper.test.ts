// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inference } from '@/api/proto.js';

const websocketMocks = vi.hoisted(() => ({
  readSingleEntry: vi.fn(),
}));

vi.mock('@/api/websocket', () => ({
  default: {
    normFs: { readSingleEntry: websocketMocks.readSingleEntry },
  },
}));

import DatasetExportHelper from './DatasetExportHelper';

describe('DatasetExportHelper', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    websocketMocks.readSingleEntry.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('opens on demand and uses the first and last tags as the initial export bounds', async () => {
    await act(async () => {
      root.render(createElement(DatasetExportHelper, {
        tags: [
          { frame: 22445334, tag: 'recording-end' },
          { frame: 18979274, tag: 'recording-start' },
        ],
      }));
    });

    expect(container.querySelector('dialog')).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
    });

    const dialog = container.querySelector<HTMLDialogElement>('dialog');
    expect(dialog?.open).toBe(true);

    const selects = dialog?.querySelectorAll('select');
    expect(selects?.[0]?.selectedOptions[0]?.textContent).toContain('recording-start');
    expect(selects?.[1]?.selectedOptions[0]?.textContent).toContain('recording-end');
  });

  it('warns when the queue has no data in the selected range', async () => {
    websocketMocks.readSingleEntry.mockResolvedValue({
      id: new Uint8Array([2]),
      data: inference.InferenceRx.encode({ entries: [] }).finish(),
    });

    await act(async () => {
      root.render(createElement(DatasetExportHelper, {
        tags: [
          { frame: 100, tag: 'recording-start' },
          { frame: 200, tag: 'recording-end' },
        ],
      }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('has no data in the selected range');
    });
  });
});
