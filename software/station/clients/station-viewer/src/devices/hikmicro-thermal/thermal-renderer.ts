import type { hikmicro } from '@/api/proto.js';
import type { ThermalPalette, ThermalRenderResult } from './thermal';
import type { ThermalRenderRequest, ThermalRenderResponse } from './thermal-worker-protocol';

/** One in flight + one replaceable pending frame, regardless of stream duration. */
export class ThermalFrameRenderer {
  private worker: Worker | null = null;
  private pending: ThermalRenderRequest | null = null;
  private busy = false;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onFrame: (result: ThermalRenderResult) => void,
    private readonly onError: (message: string) => void,
  ) {}

  render(envelope: hikmicro.IRxEnvelope, frame: hikmicro.IThermalFrame, palette: ThermalPalette): void {
    if (this.disposed) return;
    // Send only the displayed frame and calibration, not the entire frames block
    // or redundant USB descriptors/calibration chunks. Input buffers stay owned
    // by the shared frame parser; structured clone must not detach them.
    const calibration = envelope.deviceInfo?.calibration;
    this.pending = {
      payload: frame.payload ?? new Uint8Array(),
      deviceInfo: calibration ? { calibration: {
        ok: calibration.ok,
        error: calibration.error,
        container: calibration.container,
        factoryBlobOffset: calibration.factoryBlobOffset,
        factoryBlobLength: calibration.factoryBlobLength,
      } } : null,
      palette,
    };
    this.pump();
  }

  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private stopWorker(): void {
    this.clearTimeout();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.busy = false;
  }

  private pump(): void {
    if (this.disposed || this.busy || !this.pending) return;
    try {
      if (!this.worker) {
        const worker = new Worker(new URL('./thermal.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        const fail = (message: string) => {
          if (this.worker !== worker || this.disposed) return;
          this.stopWorker();
          this.onError(message);
          this.pump();
        };
        worker.onmessage = ({ data }: MessageEvent<ThermalRenderResponse>) => {
          if (this.worker !== worker || this.disposed) return;
          this.clearTimeout();
          this.busy = false;
          if (data.result) this.onFrame(data.result);
          else this.onError(data.error ?? 'Thermal decoding failed');
          this.pump();
        };
        worker.onerror = event => {
          event.preventDefault();
          fail('Thermal decoder interrupted. Reconnecting…');
        };
        worker.onmessageerror = () => fail('Thermal decoder response could not be read');
      }
      const request = this.pending;
      this.pending = null;
      this.busy = true;
      const worker = this.worker;
      this.timeout = setTimeout(() => {
        if (this.worker !== worker || this.disposed) return;
        this.stopWorker();
        this.onError('Thermal decoder timed out. Reconnecting…');
        this.pump();
      }, 10000);
      // Protobuf byte views often share the entire 25-frame envelope buffer.
      // Compact only at dispatch (not for skipped pending frames), then transfer
      // these owned copies without detaching the parser's original buffers.
      const payload = Uint8Array.from(request.payload);
      const calibration = request.deviceInfo?.calibration;
      const container = calibration?.container ? Uint8Array.from(calibration.container) : null;
      const deviceInfo = calibration ? { calibration: { ...calibration, container } } : null;
      const transfer: Transferable[] = [payload.buffer];
      if (container) transfer.push(container.buffer);
      worker.postMessage({ ...request, payload, deviceInfo }, transfer);
    } catch (error) {
      this.pending = null;
      this.stopWorker();
      this.onError(error instanceof Error ? error.message : 'Thermal decoder unavailable');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.stopWorker();
  }
}
