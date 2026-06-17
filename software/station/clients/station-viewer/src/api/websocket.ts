import { normfs, inference } from "./proto.js";
import { Frame, parseFrame } from "./frame-parser.js";
import { timeSyncManager } from "./time-sync.js";
import { NormFsClient } from "./normfs.js";
import { commandManager, CommandManager } from "./commands.js";
import Long from "long";

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
  timeSync?: {
    isActive: boolean;
    adjustmentNs: number;
    pingMs: number;
    syncCount: number;
  };
}

class WebSocketManager extends EventTarget {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 100; // 100ms
  private isUpdating = true;

  private currentFrame: Frame | null = null;
  private latestEntryId: number | null = null;
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
  };

  constructor(url: string) {
    super();
    this.url = url;
    this.stats.endpoint = url;
    this.normFs = new NormFsClient();
    this.commands = commandManager;
    this.connect();
  }

  public getCurrentFrame(): Frame | null {
    return this.currentFrame;
  }

  public async getFrame(entryId: Uint8Array, previousFrame?: Frame): Promise<Frame> {
    // Read the inference-states entry
    const streamEntry = await this.normFs.readSingleEntry('inference-states', entryId);

    // Decode as InferenceRx
    const inferenceRx = inference.InferenceRx.decode(streamEntry.data);

    // Parse frame using frame-parser, pass previous frame for optimization
    const frame = await parseFrame(inferenceRx, entryId, this.normFs, previousFrame);

    return frame;
  }

  public getLatestEntryId(): number | null {
    return this.latestEntryId;
  }

  public getConnectionStats(): ConnectionStats {
    return { ...this.stats };
  }

  private async pollLatestFrame() {
    if (this.isPolling) {
      return; // Already polling
    }

    this.isPolling = true;

    try {
      // Read the latest entry directly: backward from offset 1, limit 1
      const entry = await this.normFs.readLastEntry('inference-states');
      const entryId = Long.fromBytesLE(Array.from(entry.id)).toNumber();

      // Only process if ID changed
      if (entryId !== this.latestEntryId) {
        this.latestEntryId = entryId;

        // Decode as InferenceRx and parse frame
        const inferenceRx = inference.InferenceRx.decode(entry.data);
        const frame = await parseFrame(inferenceRx, entry.id, this.normFs, this.currentFrame || undefined, {
          retainRawData: false,
          publishVideoFrames: true,
        });

        // Update and dispatch
        this.currentFrame = frame;
        this.frameTimestamps.push(Date.now());
        this.dispatchEvent(new Event('inferenceState'));
      }
    } catch {
      // Silently ignore if queue is empty (not yet populated)
    } finally {
      this.isPolling = false;
    }
  }

  private startPolling() {
    this.stopPolling();

    console.log("WebSocket: Starting frame polling at 50Hz...");

    // Poll immediately
    this.pollLatestFrame();

    // Then poll every 20ms (50Hz)
    this.pollingInterval = window.setInterval(() => {
      if (this.isUpdating && this.isConnected()) {
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

  public stopUpdating() {
    if (!this.isUpdating) {
      return;
    }
    console.log("WebSocket: Stopping state updates.");
    this.isUpdating = false;
    this.stopPolling();
  }

  public resumeUpdating() {
    if (this.isUpdating) {
      return;
    }
    console.log("WebSocket: Resuming state updates.");
    this.isUpdating = true;
    if (this.isConnected()) {
      this.startPolling();
    }
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

  private emitStats() {
    const fpsStats = this.calculateFPS();
    this.stats.fps = fpsStats.fps;
    this.stats.isFpsReady = fpsStats.isReady;
    
    // Add time sync information
    const timeSyncState = timeSyncManager.getState();
    this.stats.timeSync = {
      isActive: timeSyncState.isActive,
      adjustmentNs: timeSyncState.timeAdjustmentNs,
      pingMs: timeSyncState.pingTimeMs,
      syncCount: timeSyncState.syncCount,
    };
    
    this.dispatchEvent(new Event('stats'));
  }

  public connect() {
    this.stats.status = 'connecting';
    this.emitStats();
    
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("WebSocket: Connection established.");
      this.stats.status = 'connected';
      this.stats.connectedAt = Date.now();
      this.stats.fps = 0;
      this.stats.isFpsReady = false;
      this.emitStats();

      this.normFs.onOpen();

      if (this.isUpdating) {
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
        // Update stats
        this.stats.packetsReceived++;
        this.stats.bytesReceived += event.data.byteLength;

        const normFsResponse = normfs.ServerResponse.decode(new Uint8Array(event.data));

        // Handle ping response for time sync
        if (normFsResponse.ping) {
          timeSyncManager.processPingResponse(normFsResponse.ping);
        }

        this.normFs.processStreamFsResponse(normFsResponse);

        this.emitStats();
      } catch (error) {
        console.error("WebSocket: Error processing message:", error);
      }
    };

    this.ws.onclose = (event) => {
      console.log("WebSocket: Connection closed.", event);
      this.stats.status = 'disconnected';
      this.stats.connectedAt = null;
      this.frameTimestamps = [];
      this.normFs.onClose();

      // Stop time sync when connection closes
      timeSyncManager.stop();

      // Stop polling
      this.stopPolling();

      this.emitStats();
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
