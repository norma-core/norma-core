import type { arduino_pro_4g_gnss } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import { STREAM_STALE_AFTER_MS, useGnssLive } from '../live-store';
import type { GnssSatellite } from '../values';
import { gnssDeviceLabel } from '../values';

const FIX_QUALITY_LABELS: Record<number, string> = {
  0: 'No fix',
  1: 'GPS',
  2: 'DGPS',
  4: 'RTK fixed',
  5: 'RTK float',
  6: 'Dead reckoning',
};

const FIX_TYPE_LABELS: Record<number, string> = {
  2: '2D',
  3: '3D',
};

const SYSTEM_BAR_COLORS: Record<string, string> = {
  GPS: 'bg-accent-success',
  GLONASS: 'bg-accent-info',
  Galileo: 'bg-accent-warning',
  BeiDou: 'bg-accent-danger',
  QZSS: 'bg-accent-pink',
  SBAS: 'bg-accent-orange',
};

const SYSTEM_TEXT_COLORS: Record<string, string> = {
  GPS: 'text-accent-success',
  GLONASS: 'text-accent-info',
  Galileo: 'text-accent-warning',
  BeiDou: 'text-accent-danger',
  QZSS: 'text-accent-pink',
  SBAS: 'text-accent-orange',
};

const MAX_SNR_DB = 50;

function formatDegrees(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(6);
}

function formatMeasured(value: number | null, unit: string, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatDop(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2);
}

/** `hhmmss.ss` → `hh:mm:ss`. */
function formatUtcTime(value: string | null): string {
  if (!value || value.length < 6) {
    return 'N/A';
  }
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
}

/** `ddmmyy` → `dd.mm.20yy`. */
function formatUtcDate(value: string | null): string {
  if (!value || value.length !== 6) {
    return 'N/A';
  }
  return `${value.slice(0, 2)}.${value.slice(2, 4)}.20${value.slice(4, 6)}`;
}

function formatAge(ms: number): string {
  const totalS = Math.round(ms / 1000);
  if (totalS < 60) {
    return `${totalS}s`;
  }
  if (totalS < 3600) {
    return `${Math.floor(totalS / 60)}m ${totalS % 60}s`;
  }
  if (totalS < 86_400) {
    return `${Math.floor(totalS / 3600)}h ${Math.floor((totalS % 3600) / 60)}m`;
  }
  return `${Math.floor(totalS / 86_400)}d ${Math.floor((totalS % 86_400) / 3600)}h`;
}

/** The driver re-injects gpsOneXTRA assistance once it is a day old, so
 * older data means the refresh is failing (no network, AT port trouble). */
const XTRA_FRESH_FOR_MS = 24 * 3600 * 1000;

function satelliteTitle(sat: GnssSatellite): string {
  const parts = [`${sat.system} ${sat.prn ?? '?'}`];
  if (sat.elevationDeg !== null) {
    parts.push(`elev ${sat.elevationDeg}°`);
  }
  if (sat.azimuthDeg !== null) {
    parts.push(`az ${sat.azimuthDeg}°`);
  }
  parts.push(sat.snrDb === null ? 'no signal' : `SNR ${sat.snrDb} dB`);
  parts.push(sat.used ? 'in fix' : 'not in fix');
  return parts.join(' · ');
}

function SatelliteBars({ satellites }: { satellites: GnssSatellite[] }) {
  // Stable order (system, then PRN) so each satellite keeps its column;
  // sorting by signal made bars swap places on every 1 Hz GSV update.
  const ordered = [...satellites].sort(
    (a, b) => a.system.localeCompare(b.system) || (a.prn ?? 0) - (b.prn ?? 0),
  );
  const systems = [...new Set(ordered.map(sat => sat.system))];

  return (
    <div className="mt-2 min-w-0">
      <div className="flex items-end gap-[3px]" style={{ height: 26 }}>
        {ordered.map(sat => {
          const snr = sat.snrDb;
          const height = snr === null ? 3 : Math.max(4, Math.round((Math.min(snr, MAX_SNR_DB) / MAX_SNR_DB) * 24));
          const color = snr === null ? 'bg-border-subtle' : (SYSTEM_BAR_COLORS[sat.system] ?? 'bg-accent-secondary');
          // Satellites contributing to the fix are solid; merely tracked ones are dimmed.
          const emphasis = sat.used ? '' : 'opacity-40';
          return (
            <div
              key={`${sat.system}-${sat.prn ?? 'x'}`}
              title={satelliteTitle(sat)}
              className={`w-[5px] rounded-sm ${color} ${emphasis}`}
              style={{ height, transition: 'height 300ms ease, opacity 300ms ease' }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[9px] uppercase">
        {systems.map(system => {
          const ofSystem = ordered.filter(sat => sat.system === system);
          const used = ofSystem.filter(sat => sat.used).length;
          return (
            <span key={system} className={SYSTEM_TEXT_COLORS[system] ?? 'text-accent-secondary'}>
              {system} {used}/{ofSystem.length}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export interface ArduinoPro4gGnssLiveViewProps {
  data: arduino_pro_4g_gnss.IRxEnvelope;
  queueId: string;
}

function ArduinoPro4gGnssLiveView({ data, queueId }: ArduinoPro4gGnssLiveViewProps) {
  // Cumulative state from the rx queue itself: the live-store catches up on
  // every epoch (frames only sample the stream and would miss the 1 Hz GSV
  // bursts), and mergeNmeaBatch updates only what each epoch carries.
  const snapshot = useGnssLive(queueId);
  const values = snapshot.values;

  // Stream health: values freeze silently when NMEA stops, so age is the
  // only honest liveness signal. Staleness comes from browser-observed
  // silence (immune to device clock skew); the displayed age prefers the
  // device stamp so backfilled pre-reboot data shows its true age.
  const nowMs = Date.now();
  const silenceMs = snapshot.lastMergeAtMs === null ? null : nowMs - snapshot.lastMergeAtMs;
  const epochAgeMs =
    snapshot.lastEpochAtMs === null
      ? silenceMs
      : Math.max(nowMs - snapshot.lastEpochAtMs, silenceMs ?? 0, 0);
  const isStale = silenceMs !== null && silenceMs > STREAM_STALE_AFTER_MS;
  const streamDown = isStale || snapshot.connected === false;

  const satellites = values?.satellites ?? [];
  const fixQuality = values?.fixQuality ?? null;
  const qualityLabel =
    fixQuality === null ? 'N/A' : (FIX_QUALITY_LABELS[fixQuality] ?? `Quality ${fixQuality}`);
  const typeLabel = values?.fixType == null ? null : FIX_TYPE_LABELS[values.fixType];
  const fixLabel = typeLabel && fixQuality ? `${qualityLabel} ${typeLabel}` : qualityLabel;
  const hasFix = !streamDown && (fixQuality ?? 0) > 0;
  // Merged state holds the last-known position through no-fix epochs; show
  // it dimmed until the fix returns.
  const hasPosition = values?.latitudeDeg != null && values?.longitudeDeg != null;
  // Pills that only mean something with a current solution dim without one.
  const liveTone = (tone: string) => (hasFix ? tone : 'text-text-muted');

  // A-GPS (gpsOneXTRA) assistance freshness. Age drives the readout:
  // green while inside the driver's one-day refresh policy, amber once
  // the refresh is overdue, red when the modem's validity has run out.
  const xtraAgeMs =
    snapshot.xtraInjectedAtMs === null ? null : Math.max(nowMs - snapshot.xtraInjectedAtMs, 0);
  const xtraExpired =
    xtraAgeMs !== null
    && snapshot.xtraValidityMinutes !== null
    && xtraAgeMs / 60_000 >= snapshot.xtraValidityMinutes;
  const xtraValue =
    xtraAgeMs === null ? 'N/A' : xtraExpired ? 'expired' : `${formatAge(xtraAgeMs)} old`;
  const xtraTone =
    xtraAgeMs === null
      ? 'text-text-muted'
      : xtraExpired
        ? 'text-accent-critical'
        : xtraAgeMs > XTRA_FRESH_FOR_MS
          ? 'text-accent-warning'
          : 'text-accent-success';

  return (
    <DeviceWidgetShell
      title={gnssDeviceLabel(data.device)}
      subtitle="Arduino Pro 4G GNSS (EG25-G)"
      error={data.error}
    >
      {streamDown && (
        <div className="mb-2 rounded border border-accent-critical bg-accent-critical/10 px-2 py-1 text-xs font-bold uppercase text-accent-critical">
          {snapshot.connected === false ? 'Receiver disconnected' : 'No data'}
          {epochAgeMs !== null && ` — last update ${formatAge(epochAgeMs)} ago`}
          {snapshot.connectionError && (
            <span className="block font-normal normal-case">{snapshot.connectionError}</span>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">
            Position{hasPosition && !hasFix ? ' (last known)' : ''}
          </div>
          <div
            className={`font-mono text-lg font-semibold leading-none ${hasFix ? 'text-accent-success' : 'text-text-muted'}`}
          >
            {hasPosition
              ? `${formatDegrees(values.latitudeDeg)}, ${formatDegrees(values.longitudeDeg)}`
              : 'N/A, N/A'}
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">
            Fix{streamDown ? ' (last known)' : ''}
          </div>
          <div
            className={`font-mono text-lg font-semibold leading-none ${
              hasFix
                ? 'text-accent-success'
                : streamDown
                  ? 'text-text-muted'
                  : 'text-accent-info'
            }`}
          >
            {fixLabel}
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="Alt" value={formatMeasured(values?.altitudeM ?? null, 'm')} tone={liveTone('text-accent-data')} />
        <DeviceMetricPill label="Speed" value={formatMeasured(values?.speedMps ?? null, 'm/s', 2)} tone={liveTone('text-accent-warning')} />
        <DeviceMetricPill label="Course" value={formatMeasured(values?.courseDeg ?? null, 'deg')} tone={liveTone('text-accent-secondary')} />
        <DeviceMetricPill
          label="Sats"
          value={`${values?.satellitesUsed ?? 0} used / ${values?.satellitesInView ?? '?'} seen`}
          tone={streamDown ? 'text-text-muted' : 'text-accent-info'}
        />
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="PDOP" value={formatDop(values?.pdop ?? null)} tone={liveTone('text-accent-secondary')} />
        <DeviceMetricPill label="HDOP" value={formatDop(values?.hdop ?? null)} tone={liveTone('text-accent-secondary')} />
        <DeviceMetricPill label="VDOP" value={formatDop(values?.vdop ?? null)} tone={liveTone('text-accent-secondary')} />
        <DeviceMetricPill label="UTC" value={formatUtcTime(values?.utcTime ?? null)} tone={streamDown ? 'text-text-muted' : 'text-accent-data'} />
        <DeviceMetricPill label="Date" value={formatUtcDate(values?.utcDate ?? null)} tone={streamDown ? 'text-text-muted' : 'text-accent-data'} />
        <DeviceMetricPill label="A-GPS" value={xtraValue} tone={xtraTone} />
      </div>
      {satellites.length > 0 ? (
        // The strip is last-known data once the stream dies; fade it so it
        // cannot be mistaken for live reception under the NO DATA banner.
        <div className={streamDown ? 'opacity-40 grayscale' : ''}>
          <SatelliteBars satellites={satellites} />
        </div>
      ) : (
        <div className="mt-2 text-[10px] uppercase text-text-muted">No satellites in view</div>
      )}
    </DeviceWidgetShell>
  );
}

export default ArduinoPro4gGnssLiveView;
