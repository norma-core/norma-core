import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  async receive(data: Uint8Array) {
    if (!this.onmessage) {
      throw new Error('WebSocket message handler is not registered');
    }
    await this.onmessage({ data: data.buffer } as MessageEvent<ArrayBuffer>);
  }
}

function getSocket(): FakeWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('WebSocketManager did not create a WebSocket');
  }
  return socket;
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
});
