import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Crosshair, FlipHorizontal2, Maximize2, Minimize2, Moon, Waves, Sun } from 'lucide-react';
import type { hikmicro } from '@/api/proto.js';
import DeviceStatusBadge from '@/components/DeviceStatusBadge';
import { useElementFullscreen, useTheme } from '@/hooks';
import { isElectron } from '@/utils/platform';
import { formatTemperatureDelta, hikmicroDeviceLabel, latestThermalFrame, type ThermalPalette } from '../thermal';
import { useThermalLiveStream } from './useThermalLiveStream';
import { useThermalPreview } from './useThermalPreview';
import ThermalHudLog from '../hud/ThermalHudLog';
import ThermalSpectrogram from '../hud/ThermalSpectrogram';
// oxlint-disable-next-line import/no-unassigned-import -- Bundle the HUD font with this device view.
import '@fontsource/share-tech-mono/400.css';
// oxlint-disable-next-line import/no-unassigned-import -- Load styles with this lazy device view.
import './thermal-mirror.css';

export interface HikmicroThermalLiveViewProps { data: hikmicro.IRxEnvelope; queueId?: string; demo?: boolean; }

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const hasUnit = value.endsWith(' °C');
  return <div className="thermal-mirror__metric" data-tone={tone}><dt>{label}</dt><dd>{hasUnit ? <>{value.slice(0, -3)} <span className="thermal-mirror__unit">°C</span></> : value}</dd></div>;
}

function HikmicroThermalLiveView({ data: recordedData, queueId, demo = false }: HikmicroThermalLiveViewProps) {
  const liveData = useThermalLiveStream(queueId);
  const data = liveData ?? recordedData;
  const surfaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contourRef = useRef<HTMLCanvasElement>(null);
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(surfaceRef);
  const { theme, setThemePreference } = useTheme();
  const [mirrored, setMirrored] = useState(true);
  const [showContours, setShowContours] = useState(false);
  const [showHud, setShowHud] = useState(true);
  const [palette, setPalette] = useState<ThermalPalette>('arctic');
  const hudActive = isFullscreen && showHud;
  const displayPalette = hudActive ? 'terminator' : palette;
  const frame = latestThermalFrame(data);
  const { stats, stale, error } = useThermalPreview(data, frame, displayPalette, canvasRef, contourRef, showContours);
  const label = hikmicroDeviceLabel(data, 'HIKMICRO');
  const available = Boolean(stats && !stale && !error);
  const reference = available ? stats!.avgC : null;
  const delta = (value: number | null | undefined) => formatTemperatureDelta(available ? value ?? null : null, reference);
  const status = error ? 'RECOVERING' : stale ? 'SIGNAL DELAYED' : stats ? demo ? 'SYNTHETIC DEMO' : 'LIVE' : 'CONNECTING';
  const fullscreenLabel = isFullscreen ? 'Exit thermal fullscreen' : 'Fullscreen thermal camera';

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`thermal-mirror:${label}`) ?? 'null');
      if (saved?.palette === 'arctic' || saved?.palette === 'silver' || saved?.palette === 'iron') setPalette(saved.palette);
      if (typeof saved?.mirrored === 'boolean') setMirrored(saved.mirrored);
    } catch { /* Optional preferences; outdoor defaults still work. */ }
  }, [label]);

  const changePalette = (next: ThermalPalette) => {
    setShowHud(false);
    setPalette(next);
    try { localStorage.setItem(`thermal-mirror:${label}`, JSON.stringify({ palette: next, mirrored })); } catch { /* Optional preference. */ }
  };
  const changeMirror = () => {
    setMirrored(!mirrored);
    try { localStorage.setItem(`thermal-mirror:${label}`, JSON.stringify({ palette, mirrored: !mirrored })); } catch { /* Optional preference. */ }
  };
  const controls = <div className="thermal-mirror__controls">
    {isFullscreen && <button type="button" className="thermal-mirror__labeled-control" onClick={() => setShowHud(value => !value)} aria-pressed={showHud} aria-label="Toggle T-800 video HUD" title="T-800 video HUD"><Crosshair aria-hidden="true" /><span className="thermal-mirror__control-label">HUD</span></button>}
    <button type="button" className="thermal-mirror__contour-control" onClick={() => setShowContours(value => !value)} aria-pressed={showContours} aria-label="Toggle thermal contours" title="Contours · lines of equal temperature"><Waves aria-hidden="true" />{isFullscreen && <span>Contours</span>}</button>
    {isFullscreen && <button type="button" className="thermal-mirror__labeled-control" onClick={changeMirror} aria-pressed={mirrored} aria-label="Mirror thermal image" title="Mirror thermal image"><FlipHorizontal2 aria-hidden="true" /><span className="thermal-mirror__control-label">Mirror</span></button>}
    {isFullscreen && <button type="button" onClick={() => setThemePreference(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</button>}
    <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreenLabel} title={fullscreenLabel}>
      {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
    </button>
  </div>;

  return (
    <section ref={surfaceRef} aria-label="Thermal mirror" className="thermal-mirror" data-fullscreen={isFullscreen} data-hud={hudActive} style={{ '--thermal-image-aspect': stats ? stats.width / stats.height : 4 / 3 } as CSSProperties}>
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
            <canvas ref={contourRef} width={1} height={1} className="thermal-mirror__contours" data-mirrored={mirrored} hidden={!showContours} aria-hidden="true" />
            {!isFullscreen && controls}
            {isFullscreen && available && (hudActive ? <div className="thermal-mirror__hud" aria-label="Video HUD telemetry">
              <div className="thermal-mirror__hud-readout">
                <span>THERMAL VISION</span>
                <strong>{demo ? 'DEMO / SYNTHETIC' : 'SENSOR / ONLINE'}</strong>
                <span>{stats?.width} × {stats?.height} / {stats?.usedCalibration ? 'CALIBRATED' : 'RAW Y16'}</span>
                <span className="thermal-mirror__hud-divider">────────────────</span>
                <span>CENTER {stats?.usedCalibration ? delta(stats.centerC) : `${stats?.centerRaw ?? '—'} RAW`}</span>
                <span>MIN {stats?.usedCalibration ? delta(stats.minC) : `${stats?.minRaw ?? '—'} RAW`}</span>
                <span>MAX {stats?.usedCalibration ? delta(stats.maxC) : `${stats?.maxRaw ?? '—'} RAW`}</span>
                <span className="thermal-mirror__hud-caption">{stats?.usedCalibration ? 'Δ / SCENE AVERAGE' : 'DETECTOR INTENSITY'}</span>
              </div>
              {stats && <ThermalHudLog frame={frame} stats={stats} />}
              {stats?.spectrum && <ThermalSpectrogram spectrum={stats.spectrum} />}
              <span className="thermal-mirror__hud-caption thermal-mirror__hud-bottom">{demo ? 'SIMULATED INPUT' : 'HIKMICRO / THERMAL STREAM'}<span>SCAN ACTIVE</span></span>
            </div> : <span className="thermal-mirror__crosshair" aria-hidden="true" />)}
            {!available && <div className="thermal-mirror__notice" data-stale={Boolean(stats)} role="status">
              <strong>{stats ? 'Signal delayed · showing last frame' : 'Connecting to thermal camera'}</strong>
              <span>{error || stats ? 'The image will resume automatically.' : 'The first frame can take a little while.'}</span>
            </div>}
          </div>
        </div>
        {!hudActive && <aside className="thermal-mirror__readings">
          <div className="thermal-mirror__relative">{isFullscreen && <span className="thermal-mirror__eyebrow">TEMPERATURE DIFFERENCE</span>}<p>{isFullscreen ? 'Relative to the average of this scene' : 'Δ relative to the frame average'}</p></div>
          <dl className="thermal-mirror__metrics">
            <Metric label="Center Δ" value={delta(stats?.centerC)} tone="warning" />
            {!isFullscreen && <Metric label="Average Δ" value={delta(stats?.avgC)} />}
            <Metric label={isFullscreen ? 'Coolest Δ' : 'Min Δ'} value={delta(stats?.minC)} tone="info" />
            <Metric label={isFullscreen ? 'Warmest Δ' : 'Max Δ'} value={delta(stats?.maxC)} tone="critical" />
          </dl>
          {isFullscreen && <><div className="thermal-mirror__scale" data-palette={displayPalette}>
            <div className="thermal-mirror__scale-bar" aria-hidden="true" />
            <div className="thermal-mirror__scale-labels"><span>Cooler</span><span>Warmer</span></div>
          </div>
          <fieldset className="thermal-mirror__palettes">
            <legend>Palette</legend>
            {(['arctic', 'silver', 'iron'] as const).map(name => <button type="button" key={name} aria-pressed={!hudActive && palette === name} onClick={() => changePalette(name)}>
              <span className="thermal-mirror__swatch" data-palette={name} aria-hidden="true" />
              {name === 'arctic' ? 'Arctic' : name === 'silver' ? 'Silver' : 'Iron'}
            </button>)}
          </fieldset></>}
          {(isFullscreen || (stats && !stats.usedCalibration)) && <p className="thermal-mirror__note">{stats && !stats.usedCalibration ? 'Relative readings unavailable. Showing heat contrast.' : 'Explore heat differences. Not a body temperature measurement.'}</p>}
        </aside>}
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
