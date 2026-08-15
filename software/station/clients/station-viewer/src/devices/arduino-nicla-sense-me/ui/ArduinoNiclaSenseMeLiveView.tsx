import type { arduino_nicla_sense_me } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
import { cardinalName, readArduinoNiclaSenseMeMainValues, vecMagnitude } from '../values';

const CUBE_SIZE_PX = 56;
const CUBE_HALF_PX = CUBE_SIZE_PX / 2;

function formatDecimal(value: number | null, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toFixed(decimals);
}

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function deviceLabel(data: arduino_nicla_sense_me.IRxEnvelope): string {
  if (!data.device) {
    return 'N/A';
  }
  if (data.device.id) {
    return data.device.id;
  }
  return `bus ${data.device.i2cBus ?? 'N/A'} / ${hexByte(data.device.i2cAddress)}`;
}

const CUBE_FACES: { className: string; transform: string; background: string }[] = [
  { className: 'front', transform: `translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(28, 92, 171, 0.85)' },
  { className: 'back', transform: `rotateY(180deg) translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(13, 54, 107, 0.9)' },
  { className: 'right', transform: `rotateY(90deg) translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(37, 106, 191, 0.85)' },
  { className: 'left', transform: `rotateY(-90deg) translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(24, 79, 149, 0.85)' },
  { className: 'top', transform: `rotateX(90deg) translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(57, 135, 229, 0.85)' },
  { className: 'bottom', transform: `rotateX(-90deg) translateZ(${CUBE_HALF_PX}px)`, background: 'rgba(16, 58, 99, 0.9)' },
];

function OrientationCube({
  headingDeg,
  pitchDeg,
  rollDeg,
}: {
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
}) {
  const heading = headingDeg ?? 0;
  const pitch = pitchDeg ?? 0;
  const roll = rollDeg ?? 0;
  // Baseline isometric view, then apply the device attitude on top.
  const transform = `rotateX(${-24 + pitch}deg) rotateY(${-30 - heading}deg) rotateZ(${roll}deg)`;

  return (
    <div style={{ width: 84, height: 84, perspective: 260 }} className="mx-auto">
      <div
        style={{
          position: 'relative',
          width: CUBE_SIZE_PX,
          height: CUBE_SIZE_PX,
          margin: '14px auto',
          transformStyle: 'preserve-3d',
          transform,
          transition: 'transform 900ms linear',
        }}
      >
        {CUBE_FACES.map((face) => (
          <div
            key={face.className}
            style={{
              position: 'absolute',
              width: CUBE_SIZE_PX,
              height: CUBE_SIZE_PX,
              border: '1px solid rgba(255,255,255,0.18)',
              background: face.background,
              transform: face.transform,
            }}
          />
        ))}
      </div>
    </div>
  );
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
          transition: 'transform 900ms linear',
        }}
      >
        <polygon points="45,45 41,49 45,12" fill="var(--color-accent-critical)" />
        <polygon points="45,45 49,41 45,78" fill="var(--color-text-muted)" />
      </g>
      <circle cx="45" cy="45" r="3" fill="var(--color-text-primary)" />
    </svg>
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
          <OrientationCube
            headingDeg={values.headingDeg}
            pitchDeg={values.pitchDeg}
            rollDeg={values.rollDeg}
          />
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

      <div className="mt-1 flex justify-center gap-4 font-mono text-xs text-text-secondary">
        <span>|a| {formatMeasured(accelMagnitude, 'g', 2)}</span>
        <span>|ω| {formatMeasured(gyroMagnitude, 'dps', 0)}</span>
        <span>|B| {formatMeasured(magMagnitude, 'µT', 0)}</span>
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <DeviceMetricPill label="IAQ" value={formatDecimal(values.iaq, 0)} tone="text-accent-warning" />
        <DeviceMetricPill label="Pressure" value={formatMeasured(values.pressureHpa, 'hPa', 0)} tone="text-accent-success" />
      </div>
    </DeviceWidgetShell>
  );
}

export default ArduinoNiclaSenseMeLiveView;
