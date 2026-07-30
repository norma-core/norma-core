import { dfrobot_rs485 } from '@/api/proto.js';

const Model = dfrobot_rs485.DfrobotSensorModel;

export type DfrobotRegisterKind = 'measurement' | 'setting' | 'comms' | 'info' | 'undocumented';

export interface DfrobotRegisterSpec {
  register: number;
  name: string;
  unit?: string;
  scale: number;
  width: 16 | 32;
  signed?: boolean;
  kind: DfrobotRegisterKind;
  decimals?: number;
}

// Register maps per model — the frontend's single source of truth, mirroring
// the hardware-verified tables in the study repo's REGISTERS.md.
// Scaling notes: PAR is ×1 (the kit doc's ×0.1 is a confirmed doc error);
// UV intensity/deviation are stored ×100; lux is 32-bit ÷1000.
const COMMS_RADIATION: DfrobotRegisterSpec[] = [
  { register: 0x07d0, name: 'address', scale: 1, width: 16, kind: 'comms' },
  { register: 0x07d1, name: 'baud_code', scale: 1, width: 16, kind: 'comms' },
  { register: 0x07d2, name: 'reg_0x07D2', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x07d3, name: 'serial_hi', scale: 1, width: 16, kind: 'info' },
  { register: 0x07d4, name: 'serial_lo', scale: 1, width: 16, kind: 'info' },
];

// Connection-static registers captured once at connect (0x0830 block +
// factory-reset magic). Values are constants on real hardware.
const STATIC_RADIATION: DfrobotRegisterSpec[] = [
  { register: 0x0834, name: 'reg_0x0834', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0837, name: 'reg_0x0837', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0839, name: 'reg_0x0839', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0840, name: 'reg_0x0840', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0841, name: 'reg_0x0841', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0842, name: 'reg_0x0842', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0844, name: 'reg_0x0844', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x0849, name: 'reg_0x0849', scale: 1, width: 16, kind: 'undocumented' },
  { register: 0x00f0, name: 'factory_reset_magic', scale: 1, width: 16, kind: 'info' },
];

export const DFROBOT_SPECS: Record<number, DfrobotRegisterSpec[]> = {
  [Model.DFROBOT_SEN0640_IRRADIANCE]: [
    { register: 0x0000, name: 'irradiance', unit: 'W/m²', scale: 1, width: 16, kind: 'measurement', decimals: 0 },
    { register: 0x0001, name: 'reg_0x0001', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0009, name: 'hardware_id', scale: 1, width: 16, kind: 'info' },
    { register: 0x0010, name: 'reg_0x0010', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0052, name: 'deviation', unit: 'W/m²', scale: 1, width: 16, signed: true, kind: 'setting' },
    { register: 0x083b, name: 'range_max', unit: 'W/m²', scale: 1, width: 16, kind: 'info', decimals: 0 },
    ...COMMS_RADIATION,
    ...STATIC_RADIATION,
  ],
  [Model.DFROBOT_SEN0641_PAR]: [
    { register: 0x0000, name: 'par', unit: 'µmol/m²·s', scale: 1, width: 16, kind: 'measurement', decimals: 0 },
    { register: 0x0001, name: 'reg_0x0001', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0002, name: 'reg_0x0002', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0003, name: 'raw_adc', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0009, name: 'hardware_id', scale: 1, width: 16, kind: 'info' },
    { register: 0x0052, name: 'deviation', unit: 'µmol/m²·s', scale: 1, width: 16, signed: true, kind: 'setting' },
    { register: 0x083b, name: 'range_max', unit: 'µmol/m²·s', scale: 1, width: 16, kind: 'info', decimals: 0 },
    ...COMMS_RADIATION,
    ...STATIC_RADIATION,
  ],
  [Model.DFROBOT_SEN0642_UV]: [
    { register: 0x0000, name: 'uv_intensity', unit: 'mW/cm²', scale: 0.01, width: 16, kind: 'measurement', decimals: 2 },
    { register: 0x0001, name: 'uv_index', unit: 'UVI', scale: 1, width: 16, kind: 'measurement', decimals: 0 },
    { register: 0x0009, name: 'hardware_id', scale: 1, width: 16, kind: 'info' },
    { register: 0x0010, name: 'reg_0x0010', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0020, name: 'reg_0x0020', scale: 1, width: 16, kind: 'undocumented' },
    { register: 0x0052, name: 'deviation', unit: 'mW/cm²', scale: 0.01, width: 16, signed: true, kind: 'setting', decimals: 2 },
    { register: 0x083b, name: 'range_max', unit: 'mW/cm²', scale: 0.01, width: 16, kind: 'info', decimals: 2 },
    ...COMMS_RADIATION,
    ...STATIC_RADIATION,
  ],
  [Model.DFROBOT_SEN0644_LIGHT]: [
    { register: 0x0002, name: 'illuminance', unit: 'Lux', scale: 0.001, width: 32, kind: 'measurement', decimals: 3 },
    { register: 0x0046, name: 'acquisition_rate', scale: 1, width: 16, kind: 'setting' },
    { register: 0x0047, name: 'calibration_enabled', scale: 1, width: 16, kind: 'setting' },
    { register: 0x0048, name: 'calibration_compensation', scale: 1, width: 16, kind: 'setting' },
    { register: 0x0064, name: 'address', scale: 1, width: 16, kind: 'comms' },
    { register: 0x0065, name: 'baud_code', scale: 1, width: 16, kind: 'comms' },
    { register: 0x0066, name: 'parity', scale: 1, width: 16, kind: 'comms' },
    { register: 0x0067, name: 'version', scale: 1, width: 16, kind: 'info' },
  ],
};

type Ranges = dfrobot_rs485.IRegisterRange[] | null | undefined;

export function readDfrobotWord(ranges: Ranges, register: number): number | null {
  if (!ranges) {
    return null;
  }
  for (const range of ranges) {
    const start = range.startRegister ?? 0;
    const data = range.data;
    if (!(data instanceof Uint8Array)) {
      continue;
    }
    const count = Math.floor(data.length / 2);
    if (register < start || register >= start + count) {
      continue;
    }
    const offset = (register - start) * 2;
    return (data[offset] << 8) | data[offset + 1];
  }
  return null;
}

function toSigned16(word: number): number {
  return word & 0x8000 ? word - 0x10000 : word;
}

export function readDfrobotRaw(ranges: Ranges, spec: DfrobotRegisterSpec): number | null {
  const hi = readDfrobotWord(ranges, spec.register);
  if (hi === null) {
    return null;
  }
  if (spec.width === 32) {
    const lo = readDfrobotWord(ranges, spec.register + 1);
    if (lo === null) {
      return null;
    }
    return hi * 65536 + lo;
  }
  return spec.signed ? toSigned16(hi) : hi;
}

export function readDfrobotValue(ranges: Ranges, spec: DfrobotRegisterSpec): number | null {
  const raw = readDfrobotRaw(ranges, spec);
  return raw === null ? null : raw * spec.scale;
}

export interface DecodedDfrobotRegister {
  spec: DfrobotRegisterSpec;
  raw: number;
  value: number;
}

export function decodeDfrobotRegisters(
  model: number | null | undefined,
  ranges: Ranges,
): { known: DecodedDfrobotRegister[]; unknown: { register: number; raw: number }[] } {
  const specs = DFROBOT_SPECS[model ?? -1] ?? [];
  const known: DecodedDfrobotRegister[] = [];
  const covered = new Set<number>();

  for (const spec of specs) {
    const raw = readDfrobotRaw(ranges, spec);
    if (raw === null) {
      continue;
    }
    const value = readDfrobotValue(ranges, spec);
    known.push({ spec, raw, value: value ?? raw });
    covered.add(spec.register);
    if (spec.width === 32) {
      covered.add(spec.register + 1);
    }
  }

  const unknown: { register: number; raw: number }[] = [];
  for (const range of ranges ?? []) {
    const start = range.startRegister ?? 0;
    const data = range.data;
    if (!(data instanceof Uint8Array)) {
      continue;
    }
    for (let i = 0; i * 2 + 1 < data.length; i++) {
      const register = start + i;
      if (!covered.has(register)) {
        unknown.push({ register, raw: (data[i * 2] << 8) | data[i * 2 + 1] });
      }
    }
  }

  return { known, unknown };
}

export function formatDfrobotValue(value: number | null, spec: DfrobotRegisterSpec): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const text = value.toFixed(spec.decimals ?? 0);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

function measurementText(model: number, ranges: Ranges, name: string): string | null {
  const spec = (DFROBOT_SPECS[model] ?? []).find((s) => s.name === name);
  if (!spec) {
    return null;
  }
  const value = readDfrobotValue(ranges, spec);
  return value === null ? null : formatDfrobotValue(value, spec);
}

export function dfrobotPrimaryText(model: number | null | undefined, ranges: Ranges): string {
  switch (model) {
    case Model.DFROBOT_SEN0640_IRRADIANCE:
      return measurementText(model, ranges, 'irradiance') ?? 'N/A';
    case Model.DFROBOT_SEN0641_PAR:
      return measurementText(model, ranges, 'par') ?? 'N/A';
    case Model.DFROBOT_SEN0642_UV: {
      const intensity = measurementText(model, ranges, 'uv_intensity');
      const index = (DFROBOT_SPECS[model] ?? []).find((s) => s.name === 'uv_index');
      const indexValue = index ? readDfrobotValue(ranges, index) : null;
      if (intensity === null) {
        return 'N/A';
      }
      return indexValue === null ? intensity : `${intensity} · UVI ${indexValue.toFixed(0)}`;
    }
    case Model.DFROBOT_SEN0644_LIGHT:
      return measurementText(model, ranges, 'illuminance') ?? 'N/A';
    default:
      return 'N/A';
  }
}

export function dfrobotModelLabel(model: number | null | undefined): string {
  switch (model) {
    case Model.DFROBOT_SEN0640_IRRADIANCE:
      return 'Irradiance';
    case Model.DFROBOT_SEN0641_PAR:
      return 'PAR';
    case Model.DFROBOT_SEN0642_UV:
      return 'UV';
    case Model.DFROBOT_SEN0644_LIGHT:
      return 'Light';
    default:
      return 'Unknown';
  }
}
