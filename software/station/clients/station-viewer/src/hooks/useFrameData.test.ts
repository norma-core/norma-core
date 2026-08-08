// @vitest-environment happy-dom

import Long from 'long';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inference } from '@/api/proto.js';
import type { StreamEntry } from '@/api/normfs.js';
import type { UseFrameDataReturn } from '@/hooks/useFrameData';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

class FakeWebSocket {
  static readonly OPEN = 1;

  readyState = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  close() {}
  send() {}
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function entryIdBytes(entryId: number): Uint8Array {
  return new Uint8Array(Long.fromNumber(entryId).toBytesLE());
}

function createFrameEntry(entryId: number): StreamEntry {
  return {
    id: entryIdBytes(entryId),
    data: inference.InferenceRx.encode({ entries: [] }).finish(),
  };
}

describe('useFrameData', () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('WebSocket', FakeWebSocket);
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

  it('keeps the latest frame when an older request finishes last', async () => {
    const { default: webSocketManager } = await import('@/api/websocket');
    const { useFrameData } = await import('@/hooks/useFrameData');
    const firstRead = createDeferred<StreamEntry>();
    const secondRead = createDeferred<StreamEntry>();
    const reads = new Map([
      [1, firstRead],
      [2, secondRead],
    ]);

    vi.spyOn(webSocketManager.normFs, 'readSingleEntry').mockImplementation(
      (_queueId, entryId) => {
        const requestedId = Long.fromBytesLE(Array.from(entryId)).toNumber();
        const read = reads.get(requestedId);
        if (!read) {
          return Promise.reject(new Error(`Unexpected frame ${requestedId}`));
        }
        return read.promise;
      },
    );

    const renderedStates: UseFrameDataReturn[] = [];
    function Probe({ frameNumber }: { frameNumber: number }) {
      renderedStates.push(useFrameData({ frameNumber, immediate: true }));
      return null;
    }

    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(Probe, { frameNumber: 1 }));
    });
    await act(async () => {
      root?.render(createElement(Probe, { frameNumber: 2 }));
    });

    await act(async () => {
      secondRead.resolve(createFrameEntry(2));
      await secondRead.promise;
    });
    expect(Array.from(renderedStates.at(-1)?.parsedFrame?.stateId ?? [])).toEqual(
      Array.from(entryIdBytes(2)),
    );

    await act(async () => {
      firstRead.resolve(createFrameEntry(1));
      await firstRead.promise;
    });

    const finalState = renderedStates.at(-1);
    expect(Array.from(finalState?.parsedFrame?.stateId ?? [])).toEqual(
      Array.from(entryIdBytes(2)),
    );
    expect(finalState?.error).toBeNull();
    expect(finalState?.isLoading).toBe(false);
  });
});
