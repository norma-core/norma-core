// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inference } from '@/api/proto.js';
import type { TagMarker } from '@/utils/inference-tags';

const websocketMocks = vi.hoisted(() => ({
  readSingleEntry: vi.fn(),
}));

vi.mock('@/api/websocket', () => ({
  default: {
    normFs: { readSingleEntry: websocketMocks.readSingleEntry },
  },
}));

import DatasetExportHelper from './DatasetExportHelper';

function tag(frame: number, name: string): TagMarker {
  return { frame, pointer: Uint8Array.of(frame), tag: name };
}

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

  it('warns when the queue has no data in the selected range', async () => {
    websocketMocks.readSingleEntry.mockResolvedValue({
      id: new Uint8Array([2]),
      data: inference.InferenceRx.encode({ entries: [] }).finish(),
    });

    await act(async () => {
      root.render(createElement(DatasetExportHelper, {
        tags: [
          tag(100, 'recording-start'),
          tag(200, 'recording-end'),
        ],
      }));
    });

    expect(container.querySelector('dialog')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('has no data in the selected range');
    });
  });
});
