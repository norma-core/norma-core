import { hikmicro } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs';

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
        const fps = data.deviceInfo?.streamFormat?.framesPerSecond || 25;
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
