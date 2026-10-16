import { arduino_nicla_sense_me } from '@/api/proto.js';
import {
  HUB_TO_ROVER,
  compassHeadingDeg,
  displayAttitude,
  gravityBody,
  linearAccelG,
  rpyRep103,
  withMount,
} from '@/devices/arduino-nicla-sense-me/attitude';
import {
  ME_CALIB,
  ME_FRESH,
  ME_HEADING_UNCALIBRATED_RAD,
  ME_OFFSETS,
  ME_REVISION,
  ME_STATUS,
  decodeArduinoNiclaSenseMe,
  isFresh,
} from '@/devices/arduino-nicla-sense-me/values';
import type { ArduinoNiclaSenseMeSample, Vec3 } from '@/devices/arduino-nicla-sense-me/values';

interface ArduinoNiclaSenseMeExpandedProps {
  data: arduino_nicla_sense_me.IRxEnvelope;
}

interface ParsedValue {
  label: string;
  value: string;
  tone?: string;
}

interface ValueGroup {
  title: string;
  values: ParsedValue[];
}

function bytesFrom(data: Uint8Array | null | undefined): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array();
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function hexBytes(bytes: Uint8Array | null | undefined): string {
  if (!bytes || bytes.length === 0) {
    return 'N/A';
  }
  return Array.from(bytes)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

function finiteNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 100000 || abs < 0.001)) {
    return value.toExponential(3);
  }
  return value.toFixed(decimals);
}

function measured(value: number | null, unit?: string, decimals = 3): string {
  if (value === null) {
    return 'N/A';
  }
  return unit ? `${finiteNumber(value, decimals)} ${unit}` : finiteNumber(value, decimals);
}

function vector(v: Vec3 | null, unit: string, decimals = 3): string {
  if (!v) {
    return 'N/A';
  }
  return `${finiteNumber(v.x, decimals)}, ${finiteNumber(v.y, decimals)}, ${finiteNumber(v.z, decimals)} ${unit}`;
}

function counts(v: Vec3): string {
  return `${v.x}, ${v.y}, ${v.z}`;
}

function byteValue(value: number): string {
  return `${value} (${hexByte(value)})`;
}

function uintValue(value: number | null): string {
  return value === null ? 'N/A' : value.toLocaleString();
}

function freshList(sample: ArduinoNiclaSenseMeSample): string {
  const names = (Object.keys(ME_FRESH) as Array<keyof typeof ME_FRESH>).filter((name) => isFresh(sample, ME_FRESH[name]));
  return names.length === 0 ? 'none' : names.join(', ');
}

function quatAccuracy(rad: number): string {
  if (!Number.isFinite(rad)) {
    return 'N/A';
  }
  const uncalibrated = rad >= ME_HEADING_UNCALIBRATED_RAD ? ', magnetometer uncalibrated' : '';
  return `${measured(rad, 'rad')} (±${(rad * 180 / Math.PI).toFixed(0)}° heading${uncalibrated})`;
}

function calibrationState(sample: ArduinoNiclaSenseMeSample): string {
  const names = (Object.keys(ME_CALIB) as Array<keyof typeof ME_CALIB>).filter((name) => (sample.calibFlags & ME_CALIB[name]) !== 0);
  return names.length === 0 ? 'cold start (no stored profile)' : names.join(', ');
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? arduino_nicla_sense_me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_SIGNAL_TYPE_UNSPECIFIED;
  const enumName = arduino_nicla_sense_me.ArduinoNiclaSenseMeSignalType[value];
  if (!enumName) {
    return String(value);
  }
  return enumName.replace(/^ARDUINO_NICLA_SENSE_ME_/, '').replace(/_/g, ' ');
}

function parsedGroups(sample: ArduinoNiclaSenseMeSample, bytes: Uint8Array): ValueGroup[] {
  // Everything in "Orientation (computed)" and the linear acceleration is
  // derived here from the raw rotation vector and accelerometer; the
  // firmware records no derived quantities. Forward = hub +Y (the mounted
  // rover's forward axis), so these match the rover HUD.
  const q = sample.quat;
  const forward = q ? withMount(q, HUB_TO_ROVER) : null;
  const rpy = forward ? rpyRep103(forward) : null;
  const attitude = rpy ? displayAttitude(rpy) : null;
  const heading = forward ? compassHeadingDeg(forward) : null;
  const gravity = q ? gravityBody(q) : null;
  const linear = q && sample.accelG ? linearAccelG(sample.accelG, q) : null;
  return [
    {
      title: 'Board',
      values: [
        { label: 'Status', value: byteValue(sample.statusByte), tone: 'text-accent-success' },
        { label: 'BHY2 running', value: (sample.statusByte & ME_STATUS.bhy2Running) !== 0 ? 'yes' : 'no', tone: 'text-accent-success' },
        { label: 'Sample counter (u8)', value: uintValue(sample.sampleCounter), tone: 'text-accent-data' },
        { label: 'Tick counter', value: uintValue(sample.tickCounter), tone: 'text-accent-data' },
        { label: 'Fresh this tick', value: freshList(sample), tone: 'text-accent-secondary' },
        { label: 'Calibration store', value: calibrationState(sample), tone: (sample.calibFlags & (ME_CALIB.storeError | ME_CALIB.restoreMismatch)) ? 'text-accent-critical' : 'text-accent-info' },
        { label: 'Minutes since profile save', value: sample.calibMinutesSinceSave === null ? 'none this session' : String(sample.calibMinutesSinceSave), tone: 'text-accent-info' },
        { label: 'Software revision', value: byteValue(sample.revision), tone: 'text-accent-data' },
        { label: 'Product ID', value: hexByte(bytes[ME_OFFSETS.productId]), tone: 'text-accent-data' },
        { label: 'Serial number', value: hexBytes(bytes.slice(ME_OFFSETS.serial, ME_OFFSETS.serial + 6)), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Motion (raw counts → scaled in viewer)',
      values: [
        { label: 'Accel counts', value: counts(sample.accelRaw), tone: 'text-accent-secondary' },
        { label: 'Accel range', value: `±${sample.accelRangeG} g`, tone: 'text-accent-secondary' },
        { label: 'Accelerometer', value: vector(sample.accelG, 'g'), tone: 'text-accent-data' },
        { label: 'Gyro counts', value: counts(sample.gyroRaw), tone: 'text-accent-secondary' },
        { label: 'Gyro range', value: `±${sample.gyroRangeDps} dps`, tone: 'text-accent-secondary' },
        { label: 'Gyroscope', value: vector(sample.gyroDps, 'dps'), tone: 'text-accent-data' },
        { label: 'Mag counts', value: counts(sample.magRaw), tone: 'text-accent-secondary' },
        { label: 'Mag scale', value: `${sample.magLsbPerUt} LSB/µT`, tone: 'text-accent-secondary' },
        { label: 'Magnetometer', value: vector(sample.magUt, 'µT'), tone: 'text-accent-data' },
      ],
    },
    {
      title: 'Orientation (quaternion measured, rest computed)',
      values: [
        {
          label: 'Quaternion (raw)',
          value: `w ${finiteNumber(sample.quatRaw.w)}, x ${finiteNumber(sample.quatRaw.x)}, y ${finiteNumber(sample.quatRaw.y)}, z ${finiteNumber(sample.quatRaw.z)}`,
          tone: 'text-accent-data',
        },
        { label: 'Quaternion accuracy', value: quatAccuracy(sample.quatAccuracyRad), tone: Number.isFinite(sample.quatAccuracyRad) && sample.quatAccuracyRad >= ME_HEADING_UNCALIBRATED_RAD ? 'text-accent-critical' : 'text-accent-info' },
        { label: 'Rotation vector usable', value: q ? 'yes' : 'no (unpopulated or off-scale)', tone: q ? 'text-accent-success' : 'text-accent-critical' },
        { label: 'Heading (fwd = sensor +Y)', value: measured(heading, '°', 1), tone: 'text-accent-warning' },
        { label: 'Pitch (nose up +)', value: measured(attitude?.pitchNoseUpDeg ?? null, '°', 1), tone: 'text-accent-warning' },
        { label: 'Roll (right down +)', value: measured(attitude?.rollRightDownDeg ?? null, '°', 1), tone: 'text-accent-warning' },
        { label: 'REP-103 yaw (CCW from east)', value: measured(rpy?.yawDeg ?? null, '°', 1), tone: 'text-accent-secondary' },
        { label: 'Gravity (body)', value: vector(gravity, 'g'), tone: 'text-accent-secondary' },
        { label: 'Linear accel', value: vector(linear, 'g'), tone: 'text-accent-secondary' },
      ],
    },
    {
      title: 'Environment',
      values: [
        { label: 'Temperature', value: measured(sample.temperatureC, 'C'), tone: 'text-accent-danger' },
        { label: 'Humidity', value: measured(sample.humidityPercent, '%'), tone: 'text-accent-info' },
        { label: 'Pressure', value: measured(sample.pressureHpa, 'hPa'), tone: 'text-accent-success' },
        { label: 'Gas resistance', value: measured(sample.gasResistanceOhm, 'Ω', 0), tone: 'text-accent-secondary' },
      ],
    },
    {
      title: 'Air Quality (BSEC)',
      values: [
        { label: 'IAQ', value: measured(sample.iaq), tone: 'text-accent-warning' },
        { label: 'Static IAQ', value: measured(sample.iaqStatic), tone: 'text-accent-warning' },
        { label: 'eCO2', value: measured(sample.eco2Ppm, 'ppm'), tone: 'text-accent-info' },
        { label: 'bVOC eq', value: measured(sample.bvocPpm, 'ppm'), tone: 'text-accent-secondary' },
        { label: 'Accuracy', value: String(sample.bsecAccuracy), tone: 'text-accent-data' },
        { label: 'Comp. temperature', value: measured(sample.compTemperatureC, 'C'), tone: 'text-accent-danger' },
        { label: 'Comp. humidity', value: measured(sample.compHumidityPercent, '%'), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Activity',
      values: [
        { label: 'Step count', value: uintValue(sample.stepCount), tone: 'text-accent-data' },
        { label: 'Activity bitfield', value: `0b${sample.activity.toString(2).padStart(16, '0')}`, tone: 'text-accent-secondary' },
      ],
    },
  ];
}

function SummaryCell({ label, value, tone = 'text-accent-data' }: ParsedValue) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="text-[10px] uppercase text-text-label">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs ${tone}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function ValueTable({ group }: { group: ValueGroup }) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">{group.title}</div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
        {group.values.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate text-text-secondary" title={item.label}>{item.label}</span>
            <span className={`max-w-[19rem] truncate font-mono ${item.tone ?? 'text-accent-data'}`} title={item.value}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArduinoNiclaSenseMeExpanded({ data }: ArduinoNiclaSenseMeExpandedProps) {
  const bytes = bytesFrom(data.data);
  const device = data.device ?? null;
  const info = device?.info ?? null;
  const sample = decodeArduinoNiclaSenseMe(bytes);
  const revisionByte = bytes.length > ME_OFFSETS.softwareRevision ? bytes[ME_OFFSETS.softwareRevision] : null;
  const groups = sample ? parsedGroups(sample, bytes) : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCell label="Signal" value={signalLabel(data.signalType)} tone={data.error ? 'text-accent-critical' : 'text-accent-success'} />
        <SummaryCell label="Device" value={device?.id ?? 'N/A'} tone="text-accent-info" />
        <SummaryCell label="Port" value={device?.usbPort || 'N/A'} tone="text-accent-warning" />
        <SummaryCell label="Payload" value={`${bytes.length.toLocaleString()} bytes`} tone="text-accent-secondary" />
        <SummaryCell label="Firmware" value={hexByte(info?.softwareRevision ?? revisionByte)} tone="text-accent-data" />
        <SummaryCell label="Product ID" value={hexByte(info?.productId ?? (bytes.length > ME_OFFSETS.productId ? bytes[ME_OFFSETS.productId] : null))} tone="text-accent-success" />
        <SummaryCell
          label="Serial"
          value={hexBytes(info?.serialNumber ?? (bytes.length >= ME_OFFSETS.serial + 6 ? bytes.slice(ME_OFFSETS.serial, ME_OFFSETS.serial + 6) : null))}
          tone="text-accent-info"
        />
        <SummaryCell label="Ticks" value={uintValue(sample?.tickCounter ?? null)} tone="text-accent-data" />
      </div>

      {data.error && (
        <div className="rounded bg-surface-primary p-2 text-xs text-accent-critical">
          {data.error}
        </div>
      )}

      {!sample && bytes.length > 0 && (
        <div className="rounded bg-surface-primary p-2 text-xs text-accent-critical">
          Register image not decodable: {bytes.length} bytes, revision {revisionByte ?? 'N/A'}. The viewer
          decodes firmware revision {ME_REVISION} only; recordings from older firmware cannot be shown, and a
          live board on older firmware must be reflashed.
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {groups.map((group) => (
          <ValueTable key={group.title} group={group} />
        ))}
      </div>
    </div>
  );
}
