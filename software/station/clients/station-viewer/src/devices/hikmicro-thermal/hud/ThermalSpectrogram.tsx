import { useEffect, useRef, useState } from 'react';
import { ThermalSpectrumHistory, type ThermalSpectrum } from './spectrum';

interface ThermalSpectrogramProps { spectrum: ThermalSpectrum; }

function ThermalSpectrogram({ spectrum }: ThermalSpectrogramProps) {
  const history = useRef(new ThermalSpectrumHistory());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState({ lower: spectrum.lower, upper: spectrum.upper, unit: spectrum.unit, clipped: false });
  useEffect(() => {
    if (document.visibilityState === 'hidden') return;
    history.current.push(spectrum, performance.now());
    const snapshot = history.current.snapshot();
    setScale({ lower: snapshot.lower, upper: snapshot.upper, unit: snapshot.unit, clipped: snapshot.clipped });
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(80, 64);
    const totals = snapshot.columns.map(column => column?.bins.reduce((sum, value) => sum + value, 0) || 1);
    for (let x = 0; x < 80; x++) {
      const column = snapshot.columns[x];
      if (!column) continue;
      for (let y = 0; y < 64; y++) {
        const bin = Math.round(snapshot.highBin - y / 63 * (snapshot.highBin - snapshot.lowBin));
        const density = Math.min(1, (column.bins[bin] / totals[x]) ** 0.28 * 1.35);
        const offset = (y * 80 + x) * 4;
        image.data[offset] = Math.round(Math.min(1, density * 2) * 255);
        image.data[offset + 1] = Math.round(Math.max(0, (density - 0.45) / 0.55) * 230);
        image.data[offset + 2] = Math.round(Math.max(0, (density - 0.7) / 0.3) * 185);
        image.data[offset + 3] = density > 0 ? 235 : 0;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [spectrum]);
  const format = (value: number) => scale.unit === '°C' ? value.toFixed(1) : Math.round(value).toLocaleString('en-US');
  return <div className="thermal-mirror__spectrogram" aria-label="Thermal distribution over the last 20 seconds">
    <div className="thermal-mirror__spectrum-heading"><span>THERMAL SPECTRUM / 20 S</span><span>PIXEL DENSITY{scale.clipped ? ' / CLIPPED' : ''}</span></div>
    <div className="thermal-mirror__spectrum-plot">
      <div className="thermal-mirror__spectrum-axis"><span>{format(scale.upper)}</span><span>{scale.unit}</span><span>{format(scale.lower)}</span></div>
      <canvas ref={canvasRef} width={80} height={64} aria-label={`Thermal distribution, ${format(scale.lower)} to ${format(scale.upper)} ${scale.unit}; brighter regions contain more pixels`} />
      <div className="thermal-mirror__spectrum-grid" aria-hidden="true" />
    </div>
    <div className="thermal-mirror__spectrum-time"><span>−20 s</span><span>−10 s</span><span>NOW</span></div>
  </div>;
}
export default ThermalSpectrogram;
