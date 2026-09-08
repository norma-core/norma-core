import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FlipHorizontal2, Maximize2, Minimize2, Moon, ScanSearch, Sun } from 'lucide-react';
import type { hikmicro } from '@/api/proto.js';
import DeviceStatusBadge from '@/components/DeviceStatusBadge';
import { useElementFullscreen, useTheme } from '@/hooks';
import { isElectron } from '@/utils/platform';
import { formatTemperatureDelta, hikmicroDeviceLabel, latestThermalFrame, type ThermalPalette } from '../thermal';
import { useThermalPreview } from './useThermalPreview';
// oxlint-disable-next-line import/no-unassigned-import -- Load styles with this lazy device view.
import './thermal-mirror.css';

export interface HikmicroThermalLiveViewProps { data: hikmicro.IRxEnvelope; }
const ObjectDetectionOverlay = lazy(() => import('@/components/object-detection/ObjectDetectionOverlay'));

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const hasUnit = value.endsWith(' °C');
  return <div className="thermal-mirror__metric" data-tone={tone}><dt>{label}</dt><dd>{hasUnit ? <>{value.slice(0, -3)} <span className="thermal-mirror__unit">°C</span></> : value}</dd></div>;
}

function HikmicroThermalLiveView({ data }: HikmicroThermalLiveViewProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(surfaceRef);
  const { theme, setThemePreference } = useTheme();
  const [mirrored, setMirrored] = useState(true);
  const [detectObjects, setDetectObjects] = useState(false);
  const [palette, setPalette] = useState<ThermalPalette>('arctic');
  const frame = latestThermalFrame(data);
  const { stats, stale, error, renderedFrameRef } = useThermalPreview(data, frame, palette, canvasRef);
  const label = hikmicroDeviceLabel(data, 'HIKMICRO');
  const available = Boolean(stats && !stale && !error);
  const reference = available ? stats!.avgC : null;
  const delta = (value: number | null | undefined) => formatTemperatureDelta(available ? value ?? null : null, reference);
  const status = error ? 'RECOVERING' : stale ? 'SIGNAL DELAYED' : stats ? 'LIVE' : 'CONNECTING';
  const fullscreenLabel = isFullscreen ? 'Exit thermal fullscreen' : 'Fullscreen thermal camera';

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`thermal-mirror:${label}`) ?? 'null');
      if (saved?.palette === 'arctic' || saved?.palette === 'silver' || saved?.palette === 'iron') setPalette(saved.palette);
      if (typeof saved?.mirrored === 'boolean') setMirrored(saved.mirrored);
    } catch { /* Optional preferences; outdoor defaults still work. */ }
  }, [label]);

  const changePalette = (next: ThermalPalette) => {
    setPalette(next);
    try { localStorage.setItem(`thermal-mirror:${label}`, JSON.stringify({ palette: next, mirrored })); } catch { /* Optional preference. */ }
  };
  const changeMirror = () => {
    setMirrored(!mirrored);
    try { localStorage.setItem(`thermal-mirror:${label}`, JSON.stringify({ palette, mirrored: !mirrored })); } catch { /* Optional preference. */ }
  };
  const controls = <div className="thermal-mirror__controls">
    <button type="button" className="thermal-mirror__objects" onClick={() => setDetectObjects(value => !value)} aria-pressed={detectObjects} aria-label="Detect objects in thermal camera" title="Objects · experimental thermal detection"><ScanSearch aria-hidden="true" />{isFullscreen && <span>Objects</span>}</button>
    {isFullscreen && <button type="button" className="thermal-mirror__labeled-control" onClick={changeMirror} aria-pressed={mirrored} aria-label="Mirror thermal image" title="Mirror thermal image"><FlipHorizontal2 aria-hidden="true" /><span className="thermal-mirror__control-label">Mirror</span></button>}
    {isFullscreen && <button type="button" onClick={() => setThemePreference(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</button>}
    <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreenLabel} title={fullscreenLabel}>
      {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
    </button>
  </div>;

  return (
    <section ref={surfaceRef} aria-label="Thermal mirror" className="thermal-mirror" data-fullscreen={isFullscreen} style={{ '--thermal-image-aspect': stats ? stats.width / stats.height : 4 / 3 } as CSSProperties}>
      <header className="thermal-mirror__header">
        {isFullscreen && <img className="thermal-mirror__brand" src={isElectron() ? './logo_with_text.svg' : '/logo_with_text.svg'} alt="NormaCore" width={2248} height={1137} />}
        {isFullscreen ? <div className="thermal-mirror__identity">
          <div className="thermal-mirror__eyebrow">HIKMICRO <span>/</span> INTERACTIVE</div>
          <h2>Thermal mirror<span className="thermal-mirror__delta">Δ</span></h2>
        </div> : <>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary" title={label}>{label}</div>
            <div className="truncate font-mono text-[11px] text-text-muted">
              {stats?.width ?? 256}x{stats?.height ?? 192}
              {' / '}{data.deviceInfo?.streamFormat?.framesPerSecond?.toFixed(1) ?? '25.0'} FPS
            </div>
          </div>
          <DeviceStatusBadge tone={stats?.usedCalibration ? 'success' : 'warning'}>
            {stats?.usedCalibration ? 'CALIBRATED' : 'RAW'}
          </DeviceStatusBadge>
        </>}
        {isFullscreen && controls}
      </header>
      <div className="thermal-mirror__body">
        <div className="thermal-mirror__view">
          <div className="thermal-mirror__image" data-ready={Boolean(stats)}>
            <canvas ref={canvasRef} width={256} height={192} className="thermal-mirror__canvas" data-mirrored={mirrored} aria-label="HIKMICRO thermal frame" />
            {detectObjects && stats && <Suspense fallback={<span role="status" className="absolute bottom-3 left-3 rounded bg-white px-2 py-1 text-xs text-slate-800">Loading object detection…</span>}><ObjectDetectionOverlay imageRef={canvasRef} frameIdRef={renderedFrameRef} fit="contain" mirrored={mirrored} sourceStale={!available} experimental /></Suspense>}
            {!isFullscreen && controls}
            {isFullscreen && available && <span className="thermal-mirror__crosshair" aria-hidden="true" />}
            {!available && <div className="thermal-mirror__notice" data-stale={Boolean(stats)} role="status">
              <strong>{stats ? 'Signal delayed · showing last frame' : 'Connecting to thermal camera'}</strong>
              <span>{error || stats ? 'The image will resume automatically.' : 'The first frame can take a little while.'}</span>
            </div>}
          </div>
        </div>
        <aside className="thermal-mirror__readings">
          <div className="thermal-mirror__relative">{isFullscreen && <span className="thermal-mirror__eyebrow">TEMPERATURE DIFFERENCE</span>}<p>{isFullscreen ? 'Relative to the average of this scene' : 'Δ relative to the frame average'}</p></div>
          <dl className="thermal-mirror__metrics">
            <Metric label="Center Δ" value={delta(stats?.centerC)} tone="warning" />
            {!isFullscreen && <Metric label="Average Δ" value={delta(stats?.avgC)} />}
            <Metric label={isFullscreen ? 'Coolest Δ' : 'Min Δ'} value={delta(stats?.minC)} tone="info" />
            <Metric label={isFullscreen ? 'Warmest Δ' : 'Max Δ'} value={delta(stats?.maxC)} tone="critical" />
          </dl>
          {isFullscreen && <><div className="thermal-mirror__scale" data-palette={palette}>
            <div className="thermal-mirror__scale-bar" aria-hidden="true" />
            <div className="thermal-mirror__scale-labels"><span>Cooler</span><span>Warmer</span></div>
          </div>
          <fieldset className="thermal-mirror__palettes">
            <legend>Palette</legend>
            {(['arctic', 'silver', 'iron'] as const).map(name => <button type="button" key={name} aria-pressed={palette === name} onClick={() => changePalette(name)}>
              <span className="thermal-mirror__swatch" data-palette={name} aria-hidden="true" />
              {name === 'arctic' ? 'Arctic' : name === 'silver' ? 'Silver' : 'Iron'}
            </button>)}
          </fieldset></>}
          {(isFullscreen || (stats && !stats.usedCalibration)) && <p className="thermal-mirror__note">{stats && !stats.usedCalibration ? 'Relative readings unavailable. Showing heat contrast.' : 'Explore heat differences. Not a body temperature measurement.'}</p>}
        </aside>
      </div>
      {isFullscreen && <footer className="thermal-mirror__footer">
        <span className="thermal-mirror__status" data-live={available}><i aria-hidden="true" />{status}</span>
        <span className="thermal-mirror__device" title={label}>{label}</span>
        <span className="thermal-mirror__resolution">{stats?.width ?? 256} × {stats?.height ?? 192}</span>
      </footer>}
    </section>
  );
}
export default HikmicroThermalLiveView;
