import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Maximize2 } from 'lucide-react';
import type { hikmicro } from '@/api/proto.js';
import DeviceStatusBadge from '@/components/DeviceStatusBadge';
import { useElementFullscreen } from '@/hooks';
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
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(surfaceRef);
  const [mirrored, setMirrored] = useState(true);
  const [palette, setPalette] = useState<ThermalPalette>('arctic');
  const displayPalette = isFullscreen ? 'terminator' : palette;
  const frame = latestThermalFrame(data);
  const { stats, stale, error } = useThermalPreview(data, frame, displayPalette, canvasRef);
  const label = hikmicroDeviceLabel(data, 'HIKMICRO');
  const available = Boolean(stats && !stale && !error);
  const reference = available ? stats!.avgC : null;
  const delta = (value: number | null | undefined) => formatTemperatureDelta(available ? value ?? null : null, reference);
  const status = error ? 'RECOVERING' : !stats ? 'CONNECTING' : stale ? 'SIGNAL DELAYED' : demo ? 'SYNTHETIC DEMO' : 'LIVE';
  const statusDetail = available ? null : stats ? 'LAST FRAME' : 'WAITING FOR FRAME';

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`thermal-mirror:${label}`) ?? 'null');
      if (saved?.palette === 'arctic' || saved?.palette === 'silver' || saved?.palette === 'iron') setPalette(saved.palette);
      if (typeof saved?.mirrored === 'boolean') setMirrored(saved.mirrored);
    } catch { /* Optional preferences; outdoor defaults still work. */ }
  }, [label]);

  const controls = <div className="thermal-mirror__controls">
    <button type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen thermal camera" title="Fullscreen thermal camera">
      <Maximize2 aria-hidden="true" />
    </button>
  </div>;

  return (
    <section ref={surfaceRef} aria-label="Thermal mirror" className="thermal-mirror" data-fullscreen={isFullscreen} style={{ '--thermal-image-aspect': stats ? stats.width / stats.height : 4 / 3 } as CSSProperties}>
      <header className="thermal-mirror__header">
        {isFullscreen ? <span className="thermal-mirror__brand" aria-label="NormaCore">{'// C //'}</span> : <>
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
      </header>
      <div className="thermal-mirror__body">
        <div className="thermal-mirror__view">
          <div className="thermal-mirror__image" data-ready={Boolean(stats)}>
            <canvas ref={canvasRef} width={256} height={192} className="thermal-mirror__canvas" data-mirrored={mirrored} aria-label="HIKMICRO thermal frame" />
            {!isFullscreen && controls}
            {isFullscreen && available && <div className="thermal-mirror__hud" aria-label="Video HUD telemetry">
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
            </div>}
            {!isFullscreen && !available && <div className="thermal-mirror__notice" data-stale={Boolean(stats)} role="status">
              <strong>{stats ? 'Signal delayed · showing last frame' : 'Connecting to thermal camera'}</strong>
              <span>{error || stats ? 'The image will resume automatically.' : 'The first frame can take a little while.'}</span>
            </div>}
          </div>
        </div>
        {!isFullscreen && <aside className="thermal-mirror__readings">
          <div className="thermal-mirror__relative"><p>Δ relative to the frame average</p></div>
          <dl className="thermal-mirror__metrics">
            <Metric label="Center Δ" value={delta(stats?.centerC)} tone="warning" />
            <Metric label="Average Δ" value={delta(stats?.avgC)} />
            <Metric label="Min Δ" value={delta(stats?.minC)} tone="info" />
            <Metric label="Max Δ" value={delta(stats?.maxC)} tone="critical" />
          </dl>
          {stats && !stats.usedCalibration && <p className="thermal-mirror__note">Relative readings unavailable. Showing heat contrast.</p>}
        </aside>}
      </div>
      {isFullscreen && <footer className="thermal-mirror__footer">
        <span className="thermal-mirror__status" data-live={available} data-error={Boolean(error)} role="status" aria-live="polite" aria-atomic="true">
          <i aria-hidden="true" />{status}{statusDetail && <span className="thermal-mirror__status-detail"> / {statusDetail}</span>}
        </span>
        <span className="thermal-mirror__device" title={label}>{label}</span>
        <span className="thermal-mirror__resolution">{stats?.width ?? 256} × {stats?.height ?? 192}</span>
      </footer>}
    </section>
  );
}
export default HikmicroThermalLiveView;
