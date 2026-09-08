import type { DetectionFrame, DetectionResponse } from './protocol';

export type DetectionStatus = 'loading' | 'ready' | 'error';

/** One bitmap/inference at a time; skipped frames are never copied or queued. */
export class DetectionSession {
  private worker: Worker | null = null;
  private ready = false;
  private busy = false;
  private disposed = false;
  private lastFrame = '';
  private lastStarted = -Infinity;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(private onResult: (frame: DetectionFrame) => void, private onStatus: (status: DetectionStatus) => void) {
    this.onStatus('loading');
    try {
      const worker = new Worker(new URL('./detection.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      this.timeout = setTimeout(() => this.fail(), 60000);
      worker.onmessage = ({ data }: MessageEvent<DetectionResponse>) => {
        if (this.disposed) return;
        clearTimeout(this.timeout);
        if (data.type === 'error') { this.fail(); return; }
        if (data.type === 'ready') { this.ready = true; this.onStatus('ready'); return; }
        this.busy = false;
        // Do not draw delayed detections over a scene which may have moved on.
        if (performance.now() - this.lastStarted < 1500) this.onResult(data);
      };
      worker.onerror = event => { event.preventDefault(); this.fail(); };
      worker.onmessageerror = () => this.fail();
    } catch { this.fail(); }
  }

  async detect(image: HTMLImageElement | HTMLCanvasElement, frameId: string): Promise<void> {
    const now = performance.now();
    if (this.disposed || !this.ready || this.busy || !frameId || frameId === this.lastFrame || now - this.lastStarted < 1000 / 3) return;
    if ('complete' in image && !image.complete) return;
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
    if (!width || !height) return;
    this.busy = true;
    this.lastFrame = frameId;
    this.lastStarted = now;
    this.timeout = setTimeout(() => this.fail(), 5000);
    let bitmap: ImageBitmap | undefined;
    try {
      const scale = Math.min(1, 320 / Math.max(width, height));
      bitmap = await createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(width * scale)),
        resizeHeight: Math.max(1, Math.round(height * scale)),
      });
      if (this.disposed) { bitmap.close(); return; }
      this.worker!.postMessage({ bitmap }, [bitmap]);
    } catch {
      bitmap?.close();
      if (!this.disposed) this.fail();
    }
  }

  private fail(): void {
    if (this.disposed) return;
    this.dispose();
    this.onStatus('error');
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timeout);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
}
