import { useMemo } from 'react';
import { arduino_nicla_sense_me } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import NiclaBoardScene from './NiclaBoardScene';
import { buildDecimatedAxisPolylines, historyFor } from '../sparkline';
import type { AxisPolylines } from '../sparkline';
import { cardinalName, readArduinoNiclaSenseMeMainValues, vecMagnitude } from '../values';

const AXIS_COLORS = {
  x: 'var(--color-accent-info)',
  y: 'var(--color-accent-warning)',
  z: 'var(--color-accent-success)',
} as const;

function formatDecimal(value: number | null, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toFixed(decimals);
}

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function deviceLabel(data: arduino_nicla_sense_me.IRxEnvelope): string {
  if (!data.device) {
    return 'N/A';
  }
  return data.device.id || data.device.usbPort || 'N/A';
}

function CompassDial({ headingDeg }: { headingDeg: number | null }) {
  const heading = headingDeg ?? 0;
  return (
    <svg viewBox="0 0 90 90" width="84" height="84" className="mx-auto">
      <circle cx="45" cy="45" r="38" fill="none" stroke="var(--color-border-default)" strokeWidth="2" />
      <text x="45" y="16" fill="var(--color-text-label)" fontSize="9" textAnchor="middle">N</text>
      <text x="45" y="82" fill="var(--color-text-label)" fontSize="9" textAnchor="middle">S</text>
      <text x="10" y="48" fill="var(--color-text-label)" fontSize="9" textAnchor="middle">W</text>
      <text x="80" y="48" fill="var(--color-text-label)" fontSize="9" textAnchor="middle">E</text>
      <g
        style={{
          transform: `rotate(${heading}deg)`,
          transformOrigin: '45px 45px',
          transition: 'transform 120ms linear',
        }}
      >
        <polygon points="45,45 41,49 45,12" fill="var(--color-accent-critical)" />
        <polygon points="45,45 49,41 45,78" fill="var(--color-text-muted)" />
      </g>
      <circle cx="45" cy="45" r="3" fill="var(--color-text-primary)" />
    </svg>
  );
}

function AxisSparkline({
  label,
  magnitude,
  lines,
}: {
  label: string;
  magnitude: string;
  lines: AxisPolylines;
}) {
  return (
    <div className="min-w-0">
      {/* Labels arrive pre-uppercased (units keep their case): CSS
          text-transform would turn µ into Greek capital Μ. */}
      <div className="flex items-baseline justify-between text-[10px] text-text-label">
        <span>{label}</span>
        <span className="font-mono normal-case text-text-secondary">{magnitude}</span>
      </div>
      <svg viewBox="0 0 220 30" width="100%" height="30" preserveAspectRatio="none" className="block">
        {lines.zeroY !== null && (
          <line
            x1="0"
            y1={lines.zeroY}
            x2="220"
            y2={lines.zeroY}
            stroke="var(--color-border-default)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline points={lines.x} fill="none" stroke={AXIS_COLORS.x} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={lines.y} fill="none" stroke={AXIS_COLORS.y} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={lines.z} fill="none" stroke={AXIS_COLORS.z} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export interface ArduinoNiclaSenseMeLiveViewProps {
  data: arduino_nicla_sense_me.IRxEnvelope;
}

function ArduinoNiclaSenseMeLiveView({ data }: ArduinoNiclaSenseMeLiveViewProps) {
  const values = readArduinoNiclaSenseMeMainValues(data.data);
  const accelMagnitude = vecMagnitude(values.accelG);
  const gyroMagnitude = vecMagnitude(values.gyroDps);
  const magMagnitude = vecMagnitude(values.magUt);
  const heading = values.headingDeg;

  // Rolling graph history: only REGISTERS_SNAPSHOT envelopes carry a fresh
  // sample — connected/disconnected/error envelopes re-send the last good
  // image under a new stamp and would append stale or duplicate points.
  // Pushes are further deduped by the envelope stamp, so running this
  // during render (incl. StrictMode double-renders) is safe.
  const isSnapshot =
    data.signalType ===
    arduino_nicla_sense_me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_REGISTERS_SNAPSHOT;
  const historyKey = data.device?.id || 'arduino-nicla-sense-me';
  const sampleKey = `${data.monotonicStampNs ?? ''}`;
  const accelHistory = historyFor(`${historyKey}/accel`, 600);
  const gyroHistory = historyFor(`${historyKey}/gyro`, 600);
  const magHistory = historyFor(`${historyKey}/mag`, 600);
  if (isSnapshot && sampleKey !== '') {
    accelHistory.push(sampleKey, values.accelG);
    gyroHistory.push(sampleKey, values.gyroDps);
    magHistory.push(sampleKey, values.magUt);
  }

  // The histories are module-level stores mutated in place: sampleKey
  // advances exactly when they can gain a sample, historyKey switches
  // stores, so these two keys cover every change the polylines depend on.
  const sparklines = useMemo(
    () => ({
      accel: buildDecimatedAxisPolylines(accelHistory.get(), 220, 30, 2, 110),
      gyro: buildDecimatedAxisPolylines(gyroHistory.get(), 220, 30, 20, 110),
      mag: buildDecimatedAxisPolylines(magHistory.get(), 220, 30, 100, 110),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyKey, sampleKey],
  );

  return (
    <DeviceWidgetShell title={deviceLabel(data)} subtitle="Arduino Sense ME" error={data.error}>
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">Temperature</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-danger">
            {formatDecimal(values.temperatureC, 1)}
            <span className="ml-1 text-sm text-text-muted">C</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">Humidity</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-info">
            {formatDecimal(values.humidityPercent, 0)}
            <span className="ml-1 text-xs text-text-muted">%</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-start justify-around gap-2">
        <div className="text-center">
          <NiclaBoardScene quat={values.quat} />
          <div className="text-[10px] uppercase text-text-label">Attitude</div>
          <div className="font-mono text-xs text-text-secondary">
            pitch {formatDecimal(values.pitchDeg, 1)}° roll {formatDecimal(values.rollDeg, 1)}°
          </div>
        </div>
        <div className="text-center">
          <CompassDial headingDeg={heading} />
          <div className="text-[10px] uppercase text-text-label">Heading</div>
          <div className="font-mono text-xs text-text-secondary">
            {heading === null || !Number.isFinite(heading)
              ? 'N/A'
              : `${heading.toFixed(0)}° ${cardinalName(heading)}`}
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <div className="flex justify-end gap-3 text-[10px] text-text-label">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <span key={axis} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: AXIS_COLORS[axis] }} />
              {axis.toUpperCase()}
            </span>
          ))}
        </div>
        <AxisSparkline
          label="ACCEL (g)"
          magnitude={`|a| ${formatMeasured(accelMagnitude, 'g', 2)}`}
          lines={sparklines.accel}
        />
        <AxisSparkline
          label="GYRO (dps)"
          magnitude={`|ω| ${formatMeasured(gyroMagnitude, 'dps', 0)}`}
          lines={sparklines.gyro}
        />
        <AxisSparkline
          label="MAG (µT)"
          magnitude={`|B| ${formatMeasured(magMagnitude, 'µT', 0)}`}
          lines={sparklines.mag}
        />
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="IAQ" value={formatDecimal(values.iaq, 0)} tone="text-accent-warning" />
        <DeviceMetricPill label="Pressure" value={formatMeasured(values.pressureHpa, 'hPa', 0)} tone="text-accent-success" />
      </div>
    </DeviceWidgetShell>
  );
}

export default ArduinoNiclaSenseMeLiveView;
