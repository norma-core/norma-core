import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Long from 'long';
import { Maximize2, Minimize2 } from 'lucide-react';
import { serverToLocal } from '@/api/timestamp-utils';
import { commandManager } from '@/api/commands';
import type { FrameEntry } from '@/api/frame-parser';
import { usbvideo } from '@/api/proto.js';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId } from '@/usbvideo/camera-source';
import { clearLiveCameraFrame, isLiveCameraSuppressed, resumeLiveCameraFrame, suppressLiveCameraFrame } from '@/usbvideo/live-camera-store';
import type { RoverMotion } from '../rover-motion';
import RoverMotionHud from './RoverMotionHud';

interface RoverCameraViewportProps {
  source?: FrameEntry<usbvideo.IRxEnvelope>;
  motion: RoverMotion | null;
  now: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onBeforeChange: () => void;
  disabled: boolean;
}
function bytesToHex(bytes?: Uint8Array | null): string {
  if (!bytes || bytes.length === 0) return '';
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fourccToString(fourcc?: number | null): string {
  if (!fourcc) return '????';
  return [24, 16, 8, 0]
    .map((shift) => String.fromCharCode((fourcc >>> shift) & 0xff))
    .join('')
    .trim();
}

function fpsLabel(fps?: number | null): string {
  if (!Number.isFinite(fps)) return '? fps';
  return `${Number(fps).toFixed(2)} fps`;
}

function formatKey(format: usbvideo.ICameraFormat): string {
  return [
    format.fourcc ?? 0,
    format.index ?? 0,
    format.width ?? 0,
    format.height ?? 0,
    Number(format.framesPerSecond ?? 0).toPrecision(8),
    bytesToHex(format.guid),
    format.frameIndex ?? 0,
  ].join(':');
}

function formatLabel(format: usbvideo.ICameraFormat): string {
  return [
    fourccToString(format.fourcc),
    `${format.width ?? 0}x${format.height ?? 0}`,
    fpsLabel(format.framesPerSecond),
  ].join(' ');
}

function uniqueFormats(formats: usbvideo.ICameraFormat[] | null | undefined) {
  const seen = new Set<string>();
  return (formats ?? []).flatMap((format) => {
    const key = formatKey(format);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, format }];
  });
}


export default function RoverCameraViewport({ source, motion, now, isFullscreen, onToggleFullscreen, onBeforeChange, disabled }: RoverCameraViewportProps) {
  const sourceId = source ? getVideoSourceId(source) : null;
  const cameraId = source?.data.camera?.uniqueId ?? '';
  const formats = useMemo(() => uniqueFormats(source?.data.formats), [source?.data.formats]);
  const [selected, setSelected] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setSelected(sourceId && isLiveCameraSuppressed(sourceId) ? 'none' : 'auto');
    setError('');
  }, [cameraId, sourceId]);
  const format = formats.find(f => f.key === selected)?.format ?? formats[0]?.format;
  const dimensions = source?.data.frames?.format ?? format;
  const aspect = dimensions?.width && dimensions?.height ? `${dimensions.width} / ${dimensions.height}` : '4 / 3';
  const stamp = source?.data.frames?.stamps?.at(-1)?.monotonicStampNs
    ?? (source?.data.type === usbvideo.RxEnvelopeType.ET_FRAMES ? source.data.stamp?.monotonicStampNs : undefined);
  const frameAgeMs = stamp ? now - serverToLocal(Long.fromValue(stamp)).toNumber() / 1e6 : Infinity;
  const videoStale = !!sourceId && selected !== 'none' && (!Number.isFinite(frameAgeMs) || frameAgeMs > 1500 || frameAgeMs < -1000);
  async function changeFormat(next: string) {
    if (busy || disabled || !cameraId) return;
    onBeforeChange(); setBusy(true); setError('');
    const manual = formats.find(f => f.key === next)?.format;
    try {
      await commandManager.sendUsbVideoCommand({ targetCameraUniqueId: cameraId,
        setFormat: { mode: next === 'none' ? usbvideo.SetFormatMode.SET_FORMAT_MODE_NONE : manual ? usbvideo.SetFormatMode.SET_FORMAT_MODE_MANUAL : usbvideo.SetFormatMode.SET_FORMAT_MODE_AUTO,
          ...(manual ? { format: manual } : {}) } });
      setSelected(next);
      if (sourceId) {
        if (next === 'none') suppressLiveCameraFrame(sourceId);
        else { resumeLiveCameraFrame(sourceId); clearLiveCameraFrame(sourceId); }
      }
    } catch {
      setError('Camera format command failed');
    }
    finally { setBusy(false); }
  }
  return <section className="rover-video" aria-label="Selected camera view" style={{ '--camera-aspect': aspect } as CSSProperties}>
    {selected === 'none' ? <div className="rover-camera-empty">Camera off</div> : sourceId ? <CameraViewer sourceId={sourceId} fit="contain" overlay="none" className="rover-camera-image" /> : <div className="rover-camera-empty">Waiting for camera</div>}
    <RoverMotionHud motion={motion} />
    <div className="rover-video-tools">
      {cameraId && <select key={cameraId} aria-label="Camera format" title={format ? formatLabel(format) : 'Camera format'} value={selected} disabled={disabled || busy} onChange={event => void changeFormat(event.target.value)}>
        <option value="auto">Auto{dimensions ? ` · ${dimensions.width} × ${dimensions.height}` : ''}</option>
        <option value="none">Off</option>
        {formats.map(({ key, format: f }) => <option key={key} value={key}>{formatLabel(f)}</option>)}
      </select>}
      <button type="button" onClick={() => { onBeforeChange(); onToggleFullscreen(); }} aria-label={isFullscreen ? 'Exit fullscreen rover control' : 'Fullscreen rover control'}>
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
    {videoStale && <div className="rover-video-status" role="status">Video stale</div>}
    {error && <div className="rover-video-error" role="alert">{error}</div>}
  </section>;
}
