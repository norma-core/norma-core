import Long from 'long';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inference, normfs } from './proto.js';

type MessageHandler = (event: MessageEvent<ArrayBuffer>) => void | Promise<void>;

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static readonly OPEN = 1;

  readyState = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: MessageHandler | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    sockets.push(this);
  }

  close() {}
  send() {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  disconnect() {
    this.readyState = 3;
    this.onclose?.();
  }

  async receive(data: Uint8Array) {
    if (!this.onmessage) {
      throw new Error('WebSocket message handler is not registered');
    }
    await this.onmessage({ data: Uint8Array.from(data).buffer } as MessageEvent<ArrayBuffer>);
  }
}

function getSocket(): FakeWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('WebSocketManager did not create a WebSocket');
  }
  return socket;
}

function createFrameResponse(readId: number, entryId: number): Uint8Array {
  const inferenceData = inference.InferenceRx.encode({ entries: [] }).finish();
  return normfs.ServerResponse.encode({
    read: {
      readId: Long.fromNumber(readId),
      result: normfs.ReadResponse.Result.RR_ENTRY,
      id: { raw: Uint8Array.of(entryId) },
      data: inferenceData,
    },
  }).finish();
}

async function finishFrameProcessing(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebSocketManager state', () => {
  beforeEach(() => {
    vi.resetModules();
    sockets.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('window', {
      location: { host: 'station.test' },
      stationDesktop: undefined,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports a malformed packet as one atomic statistics update', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: webSocketManager } = await import('./websocket');
    const publishedSnapshots: ReturnType<typeof webSocketManager.getConnectionStats>[] = [];
    const unsubscribe = webSocketManager.subscribeConnectionStats(() => {
      publishedSnapshots.push(webSocketManager.getConnectionStats());
    });
    const before = webSocketManager.getConnectionStats();

    await getSocket().receive(Uint8Array.of(0x80));

    const after = webSocketManager.getConnectionStats();
    unsubscribe();

    expect(publishedSnapshots).toHaveLength(1);
    expect(publishedSnapshots[0]).toBe(after);
    expect(after).not.toBe(before);
    expect(after.packetsReceived).toBe(before.packetsReceived + 1);
    expect(after.bytesReceived).toBe(before.bytesReceived + 1);
  });

  it('does not resume live acquisition while another history lease is active', async () => {
    const { default: webSocketManager } = await import('./websocket');
    const publishedModes: string[] = [];
    const unsubscribe = webSocketManager.subscribeConnectionStats(() => {
      publishedModes.push(webSocketManager.getConnectionStats().acquisitionMode);
    });

    const releaseFirstLease = webSocketManager.acquireHistoryMode();
    const releaseSecondLease = webSocketManager.acquireHistoryMode();

    expect(webSocketManager.getConnectionStats().acquisitionMode).toBe('history');
    expect(publishedModes).toEqual(['history']);

    releaseFirstLease();
    releaseFirstLease();
    expect(webSocketManager.getConnectionStats().acquisitionMode).toBe('history');
    expect(publishedModes).toEqual(['history']);

    releaseSecondLease();
    expect(webSocketManager.getConnectionStats().acquisitionMode).toBe('live');
    expect(publishedModes).toEqual(['history', 'live']);

    unsubscribe();
  });

  it('does not publish an in-flight frame after the connection closes', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { default: webSocketManager } = await import('./websocket');
    const socket = getSocket();
    const before = webSocketManager.getLiveSnapshot();
    const publishedSnapshots: ReturnType<typeof webSocketManager.getLiveSnapshot>[] = [];
    const unsubscribe = webSocketManager.subscribeLive(() => {
      publishedSnapshots.push(webSocketManager.getLiveSnapshot());
    });

    socket.open();
    const responseDelivery = socket.receive(createFrameResponse(1, 7));
    socket.disconnect();
    await responseDelivery;
    await finishFrameProcessing();
    unsubscribe();

    expect(webSocketManager.getConnectionStats().status).toBe('disconnected');
    expect(webSocketManager.getLiveSnapshot()).toBe(before);
    expect(publishedSnapshots).toEqual([]);
  });

  it('publishes the current frame after reconnect when its entry ID is unchanged', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { default: webSocketManager } = await import('./websocket');
    const publishedSnapshots: ReturnType<typeof webSocketManager.getLiveSnapshot>[] = [];
    const unsubscribe = webSocketManager.subscribeLive(() => {
      publishedSnapshots.push(webSocketManager.getLiveSnapshot());
    });

    const firstSocket = getSocket();
    firstSocket.open();
    await firstSocket.receive(createFrameResponse(1, 7));
    await finishFrameProcessing();
    firstSocket.disconnect();

    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = getSocket();
    secondSocket.open();
    await secondSocket.receive(createFrameResponse(2, 7));
    await finishFrameProcessing();
    unsubscribe();

    expect(secondSocket).not.toBe(firstSocket);
    expect(publishedSnapshots.map(({ latestEntryId }) => latestEntryId)).toEqual([7, 7]);
    expect(publishedSnapshots[1]).not.toBe(publishedSnapshots[0]);
  });
});
