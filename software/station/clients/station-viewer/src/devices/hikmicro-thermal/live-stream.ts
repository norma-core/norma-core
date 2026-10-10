import { hikmicro } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs';

/** Device info is written once per capture session; its frames refer to it by queue and id. */
export class ThermalDeviceInfoCache {
  private readonly loaded = new Map<string, hikmicro.IDeviceInfo>();
  private readonly pending = new Map<string, Promise<hikmicro.IDeviceInfo | null>>();
  private readonly latest = new Map<string, hikmicro.IDeviceInfo>();

  constructor(private readonly limit = 16) {}

  get(queue: string, id: Uint8Array): hikmicro.IDeviceInfo | undefined {
    const key = `${queue}#${id.join(',')}`;
    const info = this.loaded.get(key);
    if (info) {
      this.loaded.delete(key);
      this.loaded.set(key, info);
    }
    return info;
  }

  /** The last record loaded from `queue`, for frames whose own record is still loading. */
  latestFor(queue: string): hikmicro.IDeviceInfo | undefined {
    return this.latest.get(queue);
  }

  load(client: Pick<NormFsClient, 'readSingleEntry'>, queue: string, id: Uint8Array): Promise<hikmicro.IDeviceInfo | null> {
    const loaded = this.get(queue, id);
    if (loaded) return Promise.resolve(loaded);
    const key = `${queue}#${id.join(',')}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = client.readSingleEntry(queue, id)
        .then(entry => {
          const info = hikmicro.RxEnvelope.decode(entry.data).deviceInfo ?? null;
          if (info) {
            if (this.loaded.size >= this.limit) this.loaded.delete(this.loaded.keys().next().value!);
            this.loaded.set(key, info);
            this.latest.set(queue, info);
          }
          return info;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }
}

const DEVICE_INFO_RETRY_MS = 1000;
const DEVICE_INFO_MISSING_MAX_MS = 30_000;

/**
 * Loads a session's device info until it arrives. A record that is not found yet
 * may still be on its way to the bucket, so that is retried too, backing off.
 */
export class DeviceInfoLoader {
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private missingDelay = DEVICE_INFO_RETRY_MS;

  constructor(
    private readonly cache: ThermalDeviceInfoCache,
    private readonly client: Pick<NormFsClient, 'readSingleEntry'>,
    private readonly queue: string,
    private readonly id: Uint8Array,
    private readonly onLoaded: (info: hikmicro.IDeviceInfo) => void,
    private readonly isMissing: (error: unknown) => boolean,
  ) {
    this.attempt();
  }

  /** Tries at once if a retry is waiting, as after a reconnect. */
  retryNow() {
    if (this.disposed || this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.missingDelay = DEVICE_INFO_RETRY_MS;
    this.attempt();
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private attempt() {
    this.cache.load(this.client, this.queue, this.id).then(info => {
      if (this.disposed) return;
      if (info) this.onLoaded(info);
      else this.schedule(DEVICE_INFO_RETRY_MS);
    }, (error: unknown) => {
      if (this.disposed) return;
      if (this.isMissing(error)) {
        this.schedule(this.missingDelay);
        this.missingDelay = Math.min(this.missingDelay * 2, DEVICE_INFO_MISSING_MAX_MS);
      } else {
        this.schedule(DEVICE_INFO_RETRY_MS);
      }
    });
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.attempt();
    }, delay);
  }
}

/** Poll the current tail, never a backlog. At most one read is outstanding. */
export class ThermalLiveStream {
  private enabled = false;
  private disposed = false;
  private busy = false;
  private generation = 0;
  private intervalMs = 40;
  private lastId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: Pick<NormFsClient, 'readLastEntry'>,
    private readonly queueId: string,
    private readonly onFrame: (data: hikmicro.IRxEnvelope) => void,
    private readonly sessionFor: (queue: string) => hikmicro.IDeviceInfo | undefined = () => undefined,
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    this.generation++;
    this.lastId = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (enabled) void this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.enabled || this.disposed || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    const started = performance.now();
    let retryMs = this.intervalMs;
    try {
      const entry = await this.client.readLastEntry(this.queueId);
      if (!this.enabled || this.disposed || generation !== this.generation) return;
      const id = Array.from(entry.id).join(',');
      if (id !== this.lastId) {
        const data = hikmicro.RxEnvelope.decode(entry.data);
        // Older stations still batch 25 frames: do not repeatedly download
        // the same 2.5 MB block at 25 Hz while waiting for their next batch.
        const count = data.frames?.frames?.length ?? 1;
        const session = data.deviceInfo ?? (data.deviceInfoRef?.queue ? this.sessionFor(data.deviceInfoRef.queue) : undefined);
        const fps = data.frames?.streamFormat?.framesPerSecond || session?.streamFormat?.framesPerSecond || 25;
        this.intervalMs = Math.max(40, Math.min(1000, count * 1000 / fps));
        retryMs = this.intervalMs;
        this.lastId = id;
        this.onFrame(data);
      }
    } catch {
      // Keep the last image through disconnects, missing entries and timeouts.
      // The view marks it stale; bounded retries resume at the current tail.
      retryMs = 250;
    } finally {
      this.busy = false;
      if (this.enabled && !this.disposed) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.poll();
        }, Math.max(0, retryMs - (performance.now() - started)));
      }
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.disposed = true;
  }
}
