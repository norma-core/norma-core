// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DatasetExportHelper from './DatasetExportHelper';

describe('DatasetExportHelper', () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('uses the first and last tags as the initial export bounds', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(DatasetExportHelper, {
        tags: [
          { frame: 22445334, tag: 'recording-end' },
          { frame: 18979274, tag: 'recording-start' },
        ],
      }));
    });

    const taskInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="put the cube inside box"]',
    );
    expect(taskInput).not.toBeNull();

    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setInputValue?.call(taskInput, 'put the cube inside box');
      taskInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const command = container.querySelector('pre')?.textContent;
    expect(command).toContain('-from 18979274');
    expect(command).toContain('-to 22445334');
    expect(command).toContain("-task 'put the cube inside box'");
  });
});
