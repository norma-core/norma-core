import { expect, it } from 'vitest';
import { buildThermalSpectrum, ThermalSpectrumHistory } from './spectrum';

it('counts finite samples with fixed units, including clipped range endpoints', () => {
  const spectrum = buildThermalSpectrum(new Float32Array([-100, -20, 20, 400, 500, NaN]), true);
  expect(spectrum.bins.reduce((sum, value) => sum + value, 0)).toBe(5);
  expect(spectrum.bins[0]).toBe(2);
  expect(spectrum.bins[255]).toBe(2);
  expect(spectrum.unit).toBe('°C');
  expect(spectrum.clipped).toBe(2);
});

it('retains real time gaps, replaces samples within one time bucket, and bounds history', () => {
  const history = new ThermalSpectrumHistory();
  const spectrum = buildThermalSpectrum(new Float32Array([1000, 2000]), false);
  history.push(spectrum, 0);
  history.push(spectrum, 100);
  expect(history.snapshot().columns.filter(Boolean)).toHaveLength(1);
  history.push(spectrum, 750);
  const columns = history.snapshot().columns;
  expect(columns.slice(-4).map(Boolean)).toEqual([true, false, false, true]);
  history.push(spectrum, 30000);
  expect(history.snapshot().columns).toHaveLength(80);
  expect(history.snapshot().columns.filter(Boolean)).toHaveLength(1);
  history.push(buildThermalSpectrum(new Float32Array([25]), true), 30250);
  expect(history.snapshot().columns.filter(Boolean)).toHaveLength(1);
  expect(history.snapshot().unit).toBe('°C');
});
