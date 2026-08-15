import { arduino_nicla_sense_me } from '@/api/proto.js';
import { ME_OFFSETS, ME_REGISTER_LENGTH, f32le, u8, u32le, vec3 } from '@/devices/arduino-nicla-sense-me/values';
import type { Vec3 } from '@/devices/arduino-nicla-sense-me/values';

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

function vector(v: Vec3 | null, unit: string): string {
  if (!v) {
    return 'N/A';
  }
  return `${finiteNumber(v.x)}, ${finiteNumber(v.y)}, ${finiteNumber(v.z)} ${unit}`;
}

function byteValue(bytes: Uint8Array, offset: number): string {
  const value = u8(bytes, offset);
  return value === null ? 'N/A' : `${value} (${hexByte(value)})`;
}

function uintValue(value: number | null): string {
  return value === null ? 'N/A' : value.toLocaleString();
}

function quaternion(bytes: Uint8Array): string {
  const w = f32le(bytes, ME_OFFSETS.quat);
  const x = f32le(bytes, ME_OFFSETS.quat + 4);
  const y = f32le(bytes, ME_OFFSETS.quat + 8);
  const z = f32le(bytes, ME_OFFSETS.quat + 12);
  if (w === null || x === null || y === null || z === null) {
    return 'N/A';
  }
  return `w ${finiteNumber(w)}, x ${finiteNumber(x)}, y ${finiteNumber(y)}, z ${finiteNumber(z)}`;
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? arduino_nicla_sense_me.ArduinoNiclaSenseMeSignalType.ARDUINO_NICLA_SENSE_ME_SIGNAL_TYPE_UNSPECIFIED;
  const enumName = arduino_nicla_sense_me.ArduinoNiclaSenseMeSignalType[value];
  if (!enumName) {
    return String(value);
  }
  return enumName.replace(/^ARDUINO_NICLA_SENSE_ME_/, '').replace(/_/g, ' ');
}

function parsedGroups(bytes: Uint8Array): ValueGroup[] {
  return [
    {
      title: 'Board',
      values: [
        { label: 'Status', value: byteValue(bytes, ME_OFFSETS.status), tone: 'text-accent-success' },
        { label: 'Sample counter', value: uintValue(u8(bytes, ME_OFFSETS.sampleCounter)), tone: 'text-accent-data' },
        { label: 'Software revision', value: byteValue(bytes, ME_OFFSETS.softwareRevision), tone: 'text-accent-data' },
        { label: 'Product ID', value: byteValue(bytes, ME_OFFSETS.productId), tone: 'text-accent-data' },
        {
          label: 'Serial number',
          value: bytes.length >= ME_REGISTER_LENGTH ? hexBytes(bytes.slice(ME_OFFSETS.serial, ME_OFFSETS.serial + 6)) : 'N/A',
          tone: 'text-accent-info',
        },
      ],
    },
    {
      title: 'Motion',
      values: [
        { label: 'Accelerometer', value: vector(vec3(bytes, ME_OFFSETS.accel), 'g'), tone: 'text-accent-data' },
        { label: 'Gyroscope', value: vector(vec3(bytes, ME_OFFSETS.gyro), 'dps'), tone: 'text-accent-data' },
        { label: 'Magnetometer', value: vector(vec3(bytes, ME_OFFSETS.mag), 'µT'), tone: 'text-accent-data' },
        { label: 'Linear accel', value: vector(vec3(bytes, ME_OFFSETS.linAccel), 'g'), tone: 'text-accent-secondary' },
        { label: 'Gravity', value: vector(vec3(bytes, ME_OFFSETS.gravity), 'g'), tone: 'text-accent-secondary' },
      ],
    },
    {
      title: 'Orientation',
      values: [
        { label: 'Quaternion', value: quaternion(bytes), tone: 'text-accent-data' },
        { label: 'Quaternion accuracy', value: measured(f32le(bytes, ME_OFFSETS.quat + 16), 'rad'), tone: 'text-accent-info' },
        { label: 'Heading', value: measured(f32le(bytes, ME_OFFSETS.euler), '°', 1), tone: 'text-accent-warning' },
        { label: 'Pitch', value: measured(f32le(bytes, ME_OFFSETS.euler + 4), '°', 1), tone: 'text-accent-warning' },
        { label: 'Roll', value: measured(f32le(bytes, ME_OFFSETS.euler + 8), '°', 1), tone: 'text-accent-warning' },
      ],
    },
    {
      title: 'Environment',
      values: [
        { label: 'Temperature', value: measured(f32le(bytes, ME_OFFSETS.temperature), 'C'), tone: 'text-accent-danger' },
        { label: 'Humidity', value: measured(f32le(bytes, ME_OFFSETS.humidity), '%'), tone: 'text-accent-info' },
        { label: 'Pressure', value: measured(f32le(bytes, ME_OFFSETS.pressure), 'hPa'), tone: 'text-accent-success' },
        { label: 'Gas resistance', value: measured(f32le(bytes, ME_OFFSETS.gasResistance), 'Ω', 0), tone: 'text-accent-secondary' },
      ],
    },
    {
      title: 'Air Quality (BSEC)',
      values: [
        { label: 'IAQ', value: measured(f32le(bytes, ME_OFFSETS.iaq)), tone: 'text-accent-warning' },
        { label: 'Static IAQ', value: measured(f32le(bytes, ME_OFFSETS.iaqStatic)), tone: 'text-accent-warning' },
        { label: 'eCO2', value: measured(f32le(bytes, ME_OFFSETS.eco2), 'ppm'), tone: 'text-accent-info' },
        { label: 'bVOC eq', value: measured(f32le(bytes, ME_OFFSETS.bvoc), 'ppm'), tone: 'text-accent-secondary' },
        { label: 'Accuracy', value: measured(f32le(bytes, ME_OFFSETS.bsecAccuracy), '', 0), tone: 'text-accent-data' },
        { label: 'Comp. temperature', value: measured(f32le(bytes, ME_OFFSETS.compTemperature), 'C'), tone: 'text-accent-danger' },
        { label: 'Comp. humidity', value: measured(f32le(bytes, ME_OFFSETS.compHumidity), '%'), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Activity',
      values: [
        { label: 'Step count', value: uintValue(u32le(bytes, ME_OFFSETS.stepCount)), tone: 'text-accent-data' },
        {
          label: 'Activity bitfield',
          value: (() => {
            const value = u32le(bytes, ME_OFFSETS.activity);
            return value === null ? 'N/A' : `0b${value.toString(2).padStart(16, '0')}`;
          })(),
          tone: 'text-accent-secondary',
        },
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
  const groups = parsedGroups(bytes);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCell label="Signal" value={signalLabel(data.signalType)} tone={data.error ? 'text-accent-critical' : 'text-accent-success'} />
        <SummaryCell label="Device" value={device?.id ?? 'N/A'} tone="text-accent-info" />
        <SummaryCell
          label="I2C"
          value={device ? `bus ${device.i2cBus ?? 'N/A'} / ${hexByte(device.i2cAddress)}` : 'N/A'}
          tone="text-accent-warning"
        />
        <SummaryCell label="Payload" value={`${bytes.length.toLocaleString()} bytes`} tone="text-accent-secondary" />
        <SummaryCell label="Firmware" value={hexByte(info?.softwareRevision ?? u8(bytes, ME_OFFSETS.softwareRevision))} tone="text-accent-data" />
        <SummaryCell label="Product ID" value={hexByte(info?.productId ?? u8(bytes, ME_OFFSETS.productId))} tone="text-accent-success" />
        <SummaryCell
          label="Serial"
          value={hexBytes(info?.serialNumber ?? (bytes.length >= ME_REGISTER_LENGTH ? bytes.slice(ME_OFFSETS.serial, ME_OFFSETS.serial + 6) : null))}
          tone="text-accent-info"
        />
        <SummaryCell label="Samples" value={uintValue(u8(bytes, ME_OFFSETS.sampleCounter))} tone="text-accent-data" />
      </div>

      {data.error && (
        <div className="rounded bg-surface-primary p-2 text-xs text-accent-critical">
          {data.error}
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
