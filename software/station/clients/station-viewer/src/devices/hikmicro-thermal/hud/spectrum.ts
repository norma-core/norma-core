export interface ThermalSpectrum {
  bins: Uint32Array;
  lower: number;
  upper: number;
  unit: '°C' | 'RAW';
  clipped: number;
}

/** Fixed bins keep columns comparable even while the video auto-adjusts contrast. */
export function buildThermalSpectrum(field: Float32Array, calibrated: boolean): ThermalSpectrum {
  const lower = calibrated ? -20 : 0;
  const upper = calibrated ? 400 : 65536;
  const bins = new Uint32Array(256);
  let clipped = 0;
  for (const value of field) {
    if (!Number.isFinite(value)) continue;
    if (value < lower || value > upper) clipped++;
    const bin = Math.max(0, Math.min(255, Math.floor((value - lower) / (upper - lower) * 256)));
    bins[bin]++;
  }
  return { bins, lower, upper, unit: calibrated ? '°C' : 'RAW', clipped };
}

/** Twenty seconds at 250 ms/column. Gaps remain empty, never replayed or stretched. */
export class ThermalSpectrumHistory {
  private columns: (ThermalSpectrum | null)[] = Array(80).fill(null);
  private bucket: number | null = null;
  private scale: ThermalSpectrum | null = null;

  push(spectrum: ThermalSpectrum, timeMs: number): void {
    const bucket = Math.floor(timeMs / 250);
    if (this.scale && (spectrum.unit !== this.scale.unit || spectrum.lower !== this.scale.lower || spectrum.upper !== this.scale.upper)) {
      this.columns.fill(null);
      this.bucket = null;
    }
    if (this.bucket !== null && bucket < this.bucket) return;
    if (this.bucket !== null && bucket > this.bucket) {
      const steps = Math.min(80, bucket - this.bucket);
      this.columns = this.columns.slice(steps).concat(Array(steps).fill(null));
    }
    this.bucket = bucket;
    this.scale = spectrum;
    this.columns[79] = spectrum;
  }

  snapshot() {
    // Crop the entire retained history together, never normalize each column's axis.
    let lowBin = 255, highBin = 0;
    for (const column of this.columns) {
      if (!column) continue;
      for (let bin = 0; bin < column.bins.length; bin++) {
        if (column.bins[bin] === 0) continue;
        lowBin = Math.min(lowBin, bin); highBin = Math.max(highBin, bin);
      }
    }
    if (lowBin > highBin) { lowBin = 0; highBin = 255; }
    lowBin = Math.max(0, lowBin - 2); highBin = Math.min(255, highBin + 2);
    const scale = this.scale;
    const lower = scale?.lower ?? 0, span = (scale?.upper ?? 65536) - lower;
    return { columns: this.columns.slice(), lowBin, highBin,
      lower: lower + lowBin / 256 * span, upper: lower + (highBin + 1) / 256 * span,
      unit: scale?.unit ?? 'RAW', clipped: this.columns.some(column => column && column.clipped > 0) };
  }
}
