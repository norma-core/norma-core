import { arduino_nicla_sense_env } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';

interface ParsedValue {
  label: string;
  value: string;
  tone?: string;
}

interface ParsedArrayValue {
  key: string;
  label: string;
  value: string;
}

interface ParsedArray {
  label: string;
  values: ParsedArrayValue[];
  tone?: string;
}

interface ValueGroup {
  title: string;
  values: ParsedValue[];
  arrays?: ParsedArray[];
}

function bytesFrom(data: Uint8Array | null | undefined): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array();
}

function hasRange(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function viewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

function u8(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 1) ? bytes[offset] : null;
}

function u16le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 2) ? viewFor(bytes).getUint16(offset, true) : null;
}

function u32le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 4) ? viewFor(bytes).getUint32(offset, true) : null;
}

function f32le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 4) ? viewFor(bytes).getFloat32(offset, true) : null;
}

function f32Array(bytes: Uint8Array, offset: number, count: number): ParsedArrayValue[] {
  const values: ParsedArrayValue[] = [];
  for (let idx = 0; idx < count; idx += 1) {
    const itemOffset = offset + idx * 4;
    values.push({
      key: itemOffset.toString(16).padStart(2, '0'),
      label: String(idx),
      value: measured(f32le(bytes, itemOffset)),
    });
  }
  return values;
}

function byteValue(bytes: Uint8Array, offset: number): string {
  const value = u8(bytes, offset);
  return value === null ? 'N/A' : `${value} (${hexByte(value)})`;
}

function uintValue(value: number | null): string {
  return value === null ? 'N/A' : value.toLocaleString();
}

function csvDelimiter(bytes: Uint8Array): string {
  const value = u8(bytes, 0x09);
  if (value === null) {
    return 'N/A';
  }
  const char = value >= 32 && value <= 126 ? String.fromCharCode(value) : '.';
  return `${char} (${hexByte(value)})`;
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? arduino_nicla_sense_env.ArduinoNiclaSenseEnvSignalType.ARDUINO_NICLA_SENSE_ENV_SIGNAL_TYPE_UNSPECIFIED;
  const enumName = arduino_nicla_sense_env.ArduinoNiclaSenseEnvSignalType[value];
  if (!enumName) {
    return String(value);
  }
  return enumName.replace(/^ARDUINO_NICLA_SENSE_ENV_/, '').replace(/_/g, ' ');
}

function parsedGroups(bytes: Uint8Array): ValueGroup[] {
  return [
    {
      title: 'Board',
      values: [
        { label: 'Status', value: byteValue(bytes, 0x00), tone: 'text-accent-success' },
        { label: 'I2C slave address', value: byteValue(bytes, 0x01), tone: 'text-accent-warning' },
        { label: 'Control', value: byteValue(bytes, 0x02) },
        { label: 'Orange LED', value: byteValue(bytes, 0x03), tone: 'text-accent-warning' },
        { label: 'RGB red', value: byteValue(bytes, 0x04), tone: 'text-accent-critical' },
        { label: 'RGB blue', value: byteValue(bytes, 0x05), tone: 'text-accent-info' },
        { label: 'RGB green', value: byteValue(bytes, 0x06), tone: 'text-accent-success' },
        { label: 'LED intensity', value: byteValue(bytes, 0x07) },
        { label: 'UART control', value: byteValue(bytes, 0x08) },
        { label: 'CSV delimiter', value: csvDelimiter(bytes) },
        { label: 'Software revision', value: byteValue(bytes, 0x0c), tone: 'text-accent-data' },
        { label: 'Product ID', value: byteValue(bytes, 0x0d), tone: 'text-accent-data' },
        {
          label: 'Serial number',
          value: hasRange(bytes, 0x0e, 6) ? hexBytes(bytes.slice(0x0e, 0x14)) : 'N/A',
          tone: 'text-accent-info',
        },
      ],
    },
    {
      title: 'Environment',
      values: [
        { label: 'Sample counter', value: uintValue(u32le(bytes, 0x14)), tone: 'text-accent-data' },
        { label: 'Temperature', value: measured(f32le(bytes, 0x18), 'C'), tone: 'text-accent-danger' },
        { label: 'Humidity', value: measured(f32le(bytes, 0x1c), '%'), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Outdoor Air',
      values: [
        { label: 'ZMOD4510 status', value: byteValue(bytes, 0x23), tone: 'text-accent-success' },
        { label: 'ZMOD4510 sample counter', value: uintValue(u32le(bytes, 0x24)), tone: 'text-accent-data' },
        { label: 'EPA AQI', value: uintValue(u16le(bytes, 0x28)), tone: 'text-accent-warning' },
        { label: 'Fast AQI', value: uintValue(u16le(bytes, 0x2a)), tone: 'text-accent-warning' },
        { label: 'O3', value: measured(f32le(bytes, 0x2c), 'ppb'), tone: 'text-accent-secondary' },
        { label: 'NO2', value: measured(f32le(bytes, 0x30), 'ppb'), tone: 'text-accent-secondary' },
      ],
      arrays: [
        { label: 'ZMOD4510 RMOX', values: f32Array(bytes, 0x34, 13), tone: 'text-accent-data' },
      ],
    },
    {
      title: 'Indoor Air',
      values: [
        { label: 'ZMOD4410 status', value: byteValue(bytes, 0x6b), tone: 'text-accent-success' },
        { label: 'ZMOD4410 sample counter', value: uintValue(u32le(bytes, 0x6c)), tone: 'text-accent-data' },
        { label: 'IAQ', value: measured(f32le(bytes, 0x70)), tone: 'text-accent-warning' },
        { label: 'TVOC', value: measured(f32le(bytes, 0x74), 'mg/m^3'), tone: 'text-accent-secondary' },
        { label: 'eCO2', value: measured(f32le(bytes, 0x78), 'ppm'), tone: 'text-accent-info' },
        { label: 'Relative IAQ', value: measured(f32le(bytes, 0x7c)), tone: 'text-accent-warning' },
        { label: 'EtOH', value: measured(f32le(bytes, 0x80), 'ppm'), tone: 'text-accent-secondary' },
      ],
      arrays: [
        { label: 'ZMOD4410 RMOX', values: f32Array(bytes, 0x84, 13), tone: 'text-accent-data' },
        { label: 'ZMOD4410 RCDA', values: f32Array(bytes, 0xb8, 3), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Odor',
      values: [
        { label: 'ZMOD4410 RHTR', value: measured(f32le(bytes, 0xc4)), tone: 'text-accent-data' },
        { label: 'ZMOD4410 temperature', value: measured(f32le(bytes, 0xc8), 'C'), tone: 'text-accent-danger' },
        { label: 'Odor intensity', value: measured(f32le(bytes, 0xcc)), tone: 'text-accent-secondary' },
        { label: 'Odor/sulfur class', value: byteValue(bytes, 0xd0), tone: 'text-accent-warning' },
        { label: 'Defaults', value: byteValue(bytes, 0xd4), tone: 'text-accent-data' },
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
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
        {group.values.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate text-text-secondary" title={item.label}>{item.label}</span>
            <span className={`max-w-[13rem] truncate font-mono ${item.tone ?? 'text-accent-data'}`} title={item.value}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {group.arrays?.map((array) => (
        <div key={array.label} className="mt-3">
          <div className="mb-1 text-xs text-text-label">{array.label}</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
            {array.values.map((item) => (
              <div key={`${array.label}-${item.key}`} className="flex items-center justify-between gap-2 rounded bg-surface-secondary/60 px-2 py-1 text-xs">
                <span className="font-mono text-text-muted">{item.label}</span>
                <span className={`truncate font-mono ${array.tone ?? 'text-accent-data'}`} title={item.value}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ArduinoNiclaSenseEnvHistoryView({ entry }: HistoryExpandedProps<arduino_nicla_sense_env.IRxEnvelope>) {
  const { data } = entry;
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
        <SummaryCell label="Firmware" value={hexByte(info?.softwareRevision ?? u8(bytes, 0x0c))} tone="text-accent-data" />
        <SummaryCell label="Product ID" value={hexByte(info?.productId ?? u8(bytes, 0x0d))} tone="text-accent-success" />
        <SummaryCell
          label="Serial"
          value={hexBytes(info?.serialNumber ?? (hasRange(bytes, 0x0e, 6) ? bytes.slice(0x0e, 0x14) : null))}
          tone="text-accent-info"
        />
        <SummaryCell label="Samples" value={uintValue(u32le(bytes, 0x14))} tone="text-accent-data" />
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
