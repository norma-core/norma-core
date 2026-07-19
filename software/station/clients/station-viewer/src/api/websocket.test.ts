import Long from 'long';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drivers, inference, normfs, sysinfo } from '@/api/proto.js';

type WebSocketManager = (typeof import('@/api/websocket'))['default'];
type MessageHandler = (event: MessageEvent<ArrayBuffer>) => void | Promise<void>;

interface QueuedReadResponse {
  entryId: number;
  data: Uint8Array;
}

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: MessageHandler | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private queuedReadResponses = new Map<string, QueuedReadResponse[]>();

  constructor() {
    sockets.push(this);
  }

  close() {}

  send(data: ArrayBuffer | Uint8Array) {
    const request = normfs.ClientRequest.decode(
      data instanceof Uint8Array ? data : new Uint8Array(data),
    );
    const read = request.read;
    const queueId = read?.queueId;
    const readIdValue = read?.readId;
    if (!queueId || readIdValue == null) {
      return;
    }

    const responses = this.queuedReadResponses.get(queueId);
    if (!responses || responses.length === 0) {
      return;
    }
    const response = responses.shift();
    if (!response) {
      return;
    }
    if (responses.length === 0) {
      this.queuedReadResponses.delete(queueId);
    }

    const readId = Long.fromValue(readIdValue).toNumber();
    queueMicrotask(() => {
      void this.receive(createReadResponse(readId, response.entryId, response.data));
    });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  disconnect() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  queueReadResponse(queueId: string, response: QueuedReadResponse) {
    const responses = this.queuedReadResponses.get(queueId) ?? [];
    responses.push(response);
    this.queuedReadResponses.set(queueId, responses);
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

function createReadResponse(readId: number, entryId: number, data: Uint8Array): Uint8Array {
  return normfs.ServerResponse.encode({
    read: {
      readId: Long.fromNumber(readId),
      result: normfs.ReadResponse.Result.RR_ENTRY,
      id: { raw: Uint8Array.of(entryId) },
      data,
    },
  }).finish();
}

function createFrameData(entries: inference.InferenceRx.IEntry[] = []): Uint8Array {
  return inference.InferenceRx.encode({ entries }).finish();
}

function createSysinfoData(hostname: string): Uint8Array {
  return sysinfo.Envelope.encode({ data: { hostname } }).finish();
}

function waitForNextLiveSnapshot(webSocketManager: WebSocketManager) {
  return new Promise<ReturnType<WebSocketManager['getLiveSnapshot']>>((resolve) => {
    const unsubscribe = webSocketManager.subscribeLive(() => {
      const snapshot = webSocketManager.getLiveSnapshot();
      unsubscribe();
      resolve(snapshot);
    });
  });
}

function queueFrame(
  socket: FakeWebSocket,
  frameId: number,
  entries: inference.InferenceRx.IEntry[] = [],
) {
  socket.queueReadResponse('inference-states', {
    entryId: frameId,
    data: createFrameData(entries),
  });
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
    const { default: webSocketManager } = await import('@/api/websocket');
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
    const { default: webSocketManager } = await import('@/api/websocket');
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
    const { default: webSocketManager } = await import('@/api/websocket');
    const publishedEntryIds: Array<number | null> = [];
    const unsubscribe = webSocketManager.subscribeLive(() => {
      publishedEntryIds.push(webSocketManager.getLiveSnapshot().latestEntryId);
    });

    const firstSocket = getSocket();
    firstSocket.open();
    const staleResponseDelivery = firstSocket.receive(
      createReadResponse(1, 7, createFrameData()),
    );
    firstSocket.disconnect();
    await staleResponseDelivery;

    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = getSocket();
    queueFrame(secondSocket, 8);
    const nextSnapshot = waitForNextLiveSnapshot(webSocketManager);
    secondSocket.open();
    await nextSnapshot;
    unsubscribe();

    expect(publishedEntryIds).toEqual([8]);
  });

  it('publishes the current frame after reconnect when its entry ID is unchanged', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { default: webSocketManager } = await import('@/api/websocket');
    const publishedSnapshots: ReturnType<typeof webSocketManager.getLiveSnapshot>[] = [];
    const unsubscribe = webSocketManager.subscribeLive(() => {
      publishedSnapshots.push(webSocketManager.getLiveSnapshot());
    });

    const firstSocket = getSocket();
    queueFrame(firstSocket, 7);
    const firstSnapshot = waitForNextLiveSnapshot(webSocketManager);
    firstSocket.open();
    await firstSnapshot;
    firstSocket.disconnect();

    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = getSocket();
    queueFrame(secondSocket, 7);
    const secondSnapshot = waitForNextLiveSnapshot(webSocketManager);
    secondSocket.open();
    await secondSnapshot;
    unsubscribe();

    expect(secondSocket).not.toBe(firstSocket);
    expect(publishedSnapshots.map(({ latestEntryId }) => latestEntryId)).toEqual([7, 7]);
    expect(publishedSnapshots[1]).not.toBe(publishedSnapshots[0]);
  });

  it('does not reuse decoded queue data across connections', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { default: webSocketManager } = await import('@/api/websocket');
    const sysinfoEntry: inference.InferenceRx.IEntry = {
      queue: 'system/rx',
      ptr: Uint8Array.of(3),
      type: drivers.QueueDataType.QDT_SYSTEM,
    };

    const firstSocket = getSocket();
    queueFrame(firstSocket, 7, [sysinfoEntry]);
    firstSocket.queueReadResponse('system/rx', {
      entryId: 3,
      data: createSysinfoData('old-backend'),
    });
    const firstSnapshot = waitForNextLiveSnapshot(webSocketManager);
    firstSocket.open();
    const { sysinfoCodec } = await import('@/devices/sysinfo/codec');
    expect(
      (await firstSnapshot).frame?.devices.entryOf(sysinfoCodec)?.data.data?.hostname,
    ).toBe('old-backend');
    firstSocket.disconnect();

    await vi.advanceTimersByTimeAsync(100);
    const secondSocket = getSocket();
    queueFrame(secondSocket, 7, [sysinfoEntry]);
    secondSocket.queueReadResponse('system/rx', {
      entryId: 3,
      data: createSysinfoData('new-backend'),
    });
    const secondSnapshot = waitForNextLiveSnapshot(webSocketManager);
    secondSocket.open();

    expect(
      (await secondSnapshot).frame?.devices.entryOf(sysinfoCodec)?.data.data?.hostname,
    ).toBe('new-backend');
  });
});
