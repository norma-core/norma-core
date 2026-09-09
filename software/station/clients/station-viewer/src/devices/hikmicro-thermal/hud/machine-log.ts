import type { hikmicro } from '@/api/proto.js';
import type { ThermalRenderResult } from '../thermal';

export type MachineLogStats = Pick<ThermalRenderResult, 'usedCalibration' | 'minRaw' | 'maxRaw' | 'centerRaw' | 'centerC'>;
export interface MachineLogSnapshot { receivedFrames: number; lines: { id: number; text: string }[]; rawLines: { id: number; text: string }[]; }

/** Sample the newest input only; never accumulate a video-sized log backlog. */
export class ThermalMachineLog {
  private frame: hikmicro.IThermalFrame | null = null;
  private stats: MachineLogStats | null = null;
  private receivedFrames = 0;
  private publishedFrame = 0;
  private row = 0;
  private batch = 0;
  private lines: MachineLogSnapshot['lines'] = [];
  private rawRow = 0;
  private rawLines: MachineLogSnapshot['rawLines'] = [];

  observe(frame: hikmicro.IThermalFrame | null, stats: MachineLogStats): void {
    this.stats = stats;
    if (!frame || frame === this.frame) return;
    this.frame = frame;
    this.receivedFrames++;
  }

  flush(): MachineLogSnapshot | null {
    if (this.receivedFrames === this.publishedFrame || !this.frame || !this.stats) return null;
    this.publishedFrame = this.receivedFrames;
    const payload = this.frame.payload;
    const phase = this.batch++ % 3;
    let messages: string[];
    if (!payload || payload.length < 256 * 192 * 2) {
      messages = ['Y16 / INCOMPLETE INPUT'];
      this.rawLines = [];
    } else {
      // Addresses are byte offsets into the native Y16 plane.
      const offset = ((this.receivedFrames * 3) % (256 * 192 - 3)) * 2;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const hex = (value: number, digits = 4) => value.toString(16).toUpperCase().padStart(digits, '0');
      const dump = `@${hex(offset, 5)} ${[0, 2, 4].map(step => hex(view.getUint16(offset + step, true))).join(' ')}`;
      const rawRows = [0, 1].map(row => {
        const address = (offset + row * 256 * 2) % (256 * 192 * 2 - 8);
        const words = [0, 2, 4, 6].map(step => hex(view.getUint16(address + step, true)));
        return { id: ++this.rawRow, text: `@${hex(address, 5)} ${words.join(' ')}` };
      });
      this.rawLines = [...this.rawLines, ...rawRows].slice(-16);
      if (phase === 0) messages = [`FRAME ${String(this.receivedFrames).padStart(6, '0')} / RX`, dump];
      else if (phase === 1) messages = [this.stats.usedCalibration ? 'DECODE / CALIBRATED' : 'DECODE / RAW CONTRAST', `MAP ${this.stats.minRaw}..${this.stats.maxRaw} RAW`];
      else messages = [`CENTER ${this.stats.usedCalibration && this.stats.centerC !== null && Number.isFinite(this.stats.centerC) ? `${this.stats.centerC.toFixed(1)} C` : `${this.stats.centerRaw} RAW`}`, dump];
    }
    this.lines = [...this.lines, ...messages.map(text => ({ id: ++this.row, text }))].slice(-8);
    return { receivedFrames: this.receivedFrames, lines: this.lines, rawLines: this.rawLines };
  }
}
