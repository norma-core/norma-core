import Long from "long";
import { commandManager, type CommandManager } from "@/api/commands.js";
import { parseFrame, type Frame } from "@/api/frame-parser.js";
import { NormFsClient } from "@/api/normfs.js";
import { normfs, inference } from "@/api/proto.js";
import { timeSyncManager } from "@/api/time-sync.js";
import { WS_EVENTS } from "@/api/websocket-events.js";
import { shouldLoadLiveCameraFrame } from "@/modules/usb-video/live-camera-store.js";

export const ErrConnectionNotOpen = new Error("WebSocket: Connection not open.");

export interface ConnectionStats {
  endpoint: string;
  status: 'connected' | 'connecting' | 'disconnected';
  packetsReceived: number;
  bytesReceived: number;
  stateIndex: number;
  connectedAt: number | null;
  fps: number;
  isFpsReady: boolean;
  acquisitionMode: 'live' | 'history';
  timeSync?: {
    isActive: boolean;
    adjustmentNs: number;
    pingMs: number;
    syncCount: number;
  };
}

export interface LiveSnapshot {
  frame: Frame | null;
  latestEntryId: number | null;
}

class WebSocketManager extends EventTarget {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 100; // 100ms
  private historyModeLeases = new Set<symbol>();
  private acquisitionGeneration = 0;
  private pollingResumeTimeout: number | null = null;
  private lastProcessedEntryId: number | null = null;

  private liveSnapshot: LiveSnapshot = {
    frame: null,
    latestEntryId: null,
  };
  public readonly normFs: NormFsClient;
  public readonly commands: CommandManager;

  private pollingInterval: number | null = null;
  private isPolling: boolean = false;
  private frameTimestamps: number[] = [];

  private stats: ConnectionStats = {
    endpoint: '',
    status: 'disconnected',
    packetsReceived: 0,
    bytesReceived: 0,
    stateIndex: 0,
    connectedAt: null,
    fps: 0,
    isFpsReady: false,
    acquisitionMode: 'live',
  };

  constructor(url: string) {
    super();
    this.url = url;
    this.stats = { ...this.stats, endpoint: url };
    this.normFs = new NormFsClient();
    this.commands = commandManager;
    this.connect();
  }

  public getLiveSnapshot = (): LiveSnapshot => this.liveSnapshot;

  public subscribeLive = (listener: () => void): (() => void) => {
    this.addEventListener(WS_EVENTS.INFERENCE_STATE, listener);
    return () => this.removeEventListener(WS_EVENTS.INFERENCE_STATE, listener);
  };

  public async getFrame(entryId: Uint8Array, previousFrame?: Frame): Promise<Frame> {
    // Read the inference-states entry
    const streamEntry = await this.normFs.readSingleEntry('inference-states', entryId);

    // Decode as InferenceRx
    const inferenceRx = inference.InferenceRx.decode(streamEntry.data);

    // Parse frame using frame-parser, pass previous frame for optimization
    const frame = await parseFrame(inferenceRx, entryId, this.normFs, previousFrame);

    return frame;
  }

  public getConnectionStats = (): ConnectionStats => this.stats;

  public subscribeConnectionStats = (listener: () => void): (() => void) => {
    this.addEventListener(WS_EVENTS.STATS, listener);
    return () => this.removeEventListener(WS_EVENTS.STATS, listener);
  };

  private async pollLatestFrame() {
    if (!this.isLiveMode() || this.isPolling) {
      return; // Already polling
    }

    this.isPolling = true;
    const acquisitionGeneration = this.acquisitionGeneration;

    try {
      // Read the latest entry directly: backward from offset 1, limit 1
      const entry = await this.normFs.readLastEntry('inference-states');
      const entryId = Long.fromBytesLE(Array.from(entry.id)).toNumber();

      // Only process if ID changed
      if (entryId !== this.lastProcessedEntryId) {
        // Decode as InferenceRx and parse frame
        const inferenceRx = inference.InferenceRx.decode(entry.data);
        let previousFrame: Frame | undefined;
        if (this.lastProcessedEntryId !== null && this.liveSnapshot.frame !== null) {
          previousFrame = this.liveSnapshot.frame;
        }
        const frame = await parseFrame(inferenceRx, entry.id, this.normFs, previousFrame, {
          retainRawData: false,
          shouldLoadVideoFrame: shouldLoadLiveCameraFrame,
          shouldPublishVideoFrames: () =>
            this.isLiveMode() && acquisitionGeneration === this.acquisitionGeneration,
        });

        if (!this.isLiveMode() || acquisitionGeneration !== this.acquisitionGeneration) {
          return;
        }

        // Update and dispatch
        this.lastProcessedEntryId = entryId;
        this.liveSnapshot = { frame, latestEntryId: entryId };
        this.frameTimestamps.push(Date.now());
        this.dispatchEvent(new Event(WS_EVENTS.INFERENCE_STATE));
      }
    } catch {
      // Silently ignore if queue is empty (not yet populated)
    } finally {
      this.isPolling = false;
    }
  }

  private startPolling() {
    if (!this.isLiveMode() || !this.isConnected()) {
      return;
    }

    this.stopPolling();

    console.log("WebSocket: Starting frame polling at 50Hz...");

    // Poll immediately
    this.pollLatestFrame();

    // Then poll every 20ms (50Hz)
    this.pollingInterval = window.setInterval(() => {
      if (this.isLiveMode() && this.isConnected()) {
        this.pollLatestFrame();
      }
    }, 20);
  }

  private stopPolling() {
    if (this.pollingInterval !== null) {
      console.log("WebSocket: Stopping frame polling.");
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private isLiveMode(): boolean {
    return this.historyModeLeases.size === 0;
  }

  private cancelScheduledPollingResume(): void {
    if (this.pollingResumeTimeout === null) {
      return;
    }

    window.clearTimeout(this.pollingResumeTimeout);
    this.pollingResumeTimeout = null;
  }

  private schedulePollingResume(): void {
    this.cancelScheduledPollingResume();
    this.pollingResumeTimeout = window.setTimeout(() => {
      this.pollingResumeTimeout = null;
      this.startPolling();
    }, 0);
  }

  public acquireHistoryMode(): () => void {
    const lease = Symbol('history-mode');
    const entersHistoryMode = this.isLiveMode();
    this.historyModeLeases.add(lease);

    if (entersHistoryMode) {
      console.log("WebSocket: Suspending live state updates.");
      this.acquisitionGeneration += 1;
      this.cancelScheduledPollingResume();
      this.stopPolling();
      this.emitStats();
    }

    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;

      this.historyModeLeases.delete(lease);
      if (!this.isLiveMode()) {
        return;
      }

      console.log("WebSocket: Resuming live state updates.");
      this.acquisitionGeneration += 1;
      this.emitStats();
      if (this.isConnected()) {
        this.schedulePollingResume();
      }
    };
  }

  private calculateFPS(): { fps: number; isReady: boolean } {
    const now = Date.now();
    // Filter timestamps to keep only those from the last 5 seconds
    this.frameTimestamps = this.frameTimestamps.filter(ts => now - ts <= 5000);

    if (this.frameTimestamps.length < 2) {
      return { fps: 0, isReady: false };
    }

    const firstTimestamp = this.frameTimestamps[0];
    const lastTimestamp = this.frameTimestamps[this.frameTimestamps.length - 1];
    const elapsedMs = lastTimestamp - firstTimestamp;

    if (elapsedMs < 1500) {
      return { fps: 0, isReady: false };
    }

    const fps = ((this.frameTimestamps.length - 1) * 1000) / elapsedMs;
    return { fps: Number.isFinite(fps) ? fps : 0, isReady: true };
  }

  private emitStats(patch: Partial<ConnectionStats> = {}) {
    const fpsStats = this.calculateFPS();
    const timeSyncState = timeSyncManager.getState();
    this.stats = {
      ...this.stats,
      ...patch,
      fps: fpsStats.fps,
      isFpsReady: fpsStats.isReady,
      acquisitionMode: this.isLiveMode() ? 'live' : 'history',
      timeSync: {
        isActive: timeSyncState.isActive,
        adjustmentNs: timeSyncState.timeAdjustmentNs,
        pingMs: timeSyncState.pingTimeMs,
        syncCount: timeSyncState.syncCount,
      },
    };

    this.dispatchEvent(new Event(WS_EVENTS.STATS));
  }

  public connect() {
    this.emitStats({ status: 'connecting' });
    
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("WebSocket: Connection established.");
      this.emitStats({
        status: 'connected',
        connectedAt: Date.now(),
      });

      this.normFs.onOpen();

      if (this.isLiveMode()) {
        this.startPolling();
      }

      // Initialize time sync using StreamFS ping
      timeSyncManager.initialize((request) => {
        const clientRequest: normfs.IClientRequest = {
          ping: request
        };
        this.send(clientRequest);
      });
    };

    this.ws.onmessage = async (event) => {
      try {
        const normFsResponse = normfs.ServerResponse.decode(new Uint8Array(event.data));

        // Handle ping response for time sync
        if (normFsResponse.ping) {
          timeSyncManager.processPingResponse(normFsResponse.ping);
        }

        this.normFs.processStreamFsResponse(normFsResponse);
      } catch (error) {
        console.error("WebSocket: Error processing message:", error);
      } finally {
        this.emitStats({
          packetsReceived: this.stats.packetsReceived + 1,
          bytesReceived: this.stats.bytesReceived + event.data.byteLength,
        });
      }
    };

    this.ws.onclose = (event) => {
      console.log("WebSocket: Connection closed.", event);
      this.acquisitionGeneration += 1;
      this.lastProcessedEntryId = null;
      this.frameTimestamps = [];
      this.normFs.onClose();

      // Stop time sync when connection closes
      timeSyncManager.stop();

      // Stop polling
      this.cancelScheduledPollingResume();
      this.stopPolling();

      this.emitStats({ status: 'disconnected', connectedAt: null });
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket: Error:", error);
      this.ws?.close();
    };
  }

  private reconnect() {
    console.log(`WebSocket: Reconnecting in ${this.reconnectInterval / 1000} seconds...`);
    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  public send(request: normfs.IClientRequest) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const clientRequest = normfs.ClientRequest.create(request);
      const buffer = normfs.ClientRequest.encode(clientRequest).finish();
      this.ws.send(buffer as unknown as ArrayBuffer);
    } else {
      throw ErrConnectionNotOpen;
    }
  }
}


// Use desktop preload API if available (Electron), otherwise derive from page host
// With file:// protocol, window.location.host is empty — fall back to localhost
const host = window.location.host;
const wsUrl = window.stationDesktop?.backendUrl ?? (host ? `ws://${host}/api` : 'ws://127.0.0.1:8889/api');
const webSocketManager = new WebSocketManager(wsUrl);

export default webSocketManager;
