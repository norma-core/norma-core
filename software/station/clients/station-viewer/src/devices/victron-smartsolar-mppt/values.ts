import { victron_smartsolar_mppt } from '@/api/proto.js';

const textDecoder = new TextDecoder();

export const REG_DEVICE_MODE = 0x0200;
export const REG_DEVICE_STATE = 0x0201;
export const REG_REMOTE_CONTROL_USED = 0x0202;
export const REG_SOLAR_ACTIVITY = 0x2030;
export const REG_LOAD_OFF_REASON = 0xed91;
export const REG_LOAD_OUTPUT_VOLTAGE = 0xeda9;
export const REG_CHARGER_VOLTAGE = 0xedd5;
export const REG_CHARGER_INTERNAL_TEMP = 0xeddb;

export interface VictronTextValues {
  batteryVoltageV: number | null;
  batteryCurrentA: number | null;
  panelVoltageV: number | null;
  panelPowerW: number | null;
  loadOn: boolean | null;
  loadCurrentA: number | null;
  chargeState: number | null;
  mpptMode: number | null;
  errorCode: number | null;
  offReason: number | null;
  yieldTotalKwh: number | null;
  yieldTodayKwh: number | null;
  maxPowerTodayW: number | null;
  yieldYesterdayKwh: number | null;
  maxPowerYesterdayW: number | null;
}

export const EMPTY_TEXT_VALUES: VictronTextValues = {
  batteryVoltageV: null,
  batteryCurrentA: null,
  panelVoltageV: null,
  panelPowerW: null,
  loadOn: null,
  loadCurrentA: null,
  chargeState: null,
  mpptMode: null,
  errorCode: null,
  offReason: null,
  yieldTotalKwh: null,
  yieldTodayKwh: null,
  maxPowerTodayW: null,
  yieldYesterdayKwh: null,
  maxPowerYesterdayW: null,
};

export const CHARGE_STATE_LABELS: Record<number, string> = {
  0: 'Not charging',
  2: 'Fault',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  6: 'Storage',
  7: 'Manual equalise',
  245: 'Wake-up',
  247: 'Auto equalise',
  250: 'Blocked',
  252: 'External control',
  255: 'Unavailable',
};

export const DEVICE_MODE_LABELS: Record<number, string> = {
  0: 'Charger off',
  1: 'Charger on',
  4: 'Charger off',
};

export const MPPT_MODE_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'Limited',
  2: 'MPP tracker',
};

export const SOLAR_ACTIVITY_LABELS: Record<number, string> = {
  0: 'Dark',
  1: 'Light',
};

export const ERROR_LABELS: Record<number, string> = {
  0: 'No error',
  2: 'Battery voltage high',
  3: 'Battery temp sensor issue',
  4: 'Battery temp sensor issue',
  5: 'Battery temp sensor issue',
  6: 'Battery voltage sensor issue',
  7: 'Battery voltage sensor issue',
  8: 'Battery voltage sensor issue',
  14: 'Battery temp too low',
  17: 'Charger too hot',
  18: 'Charger over-current',
  19: 'Charger current reversed',
  20: 'Bulk time expired',
  21: 'Current sensor issue',
  22: 'Charger temp sensor issue',
  23: 'Charger temp sensor issue',
  26: 'Terminals overheated',
  27: 'Charger short circuit',
  28: 'Converter issue',
  29: 'Over-charge protection',
  33: 'Input voltage high',
  34: 'Input current high',
  38: 'Input shutdown (battery)',
  39: 'Input shutdown (converter off)',
  66: 'Incompatible device',
  67: 'BMS connection lost',
  68: 'Network misconfigured',
  116: 'Calibration lost',
  117: 'Incompatible firmware',
  119: 'Settings invalid',
};

export const DEVICE_OFF_REASON_BITS: Record<number, string> = {
  0: 'No input power',
  1: 'Physical power switch',
  2: 'Soft power switch',
  3: 'Remote input',
  4: 'Internal reason',
  5: 'Pay-as-you-go out of credit',
  6: 'BMS shutdown',
  9: 'Battery temp too low',
};

export const LOAD_OFF_REASON_BITS: Record<number, string> = {
  0: 'Battery low',
  1: 'Short circuit',
  2: 'Timer program',
  3: 'Remote input',
  4: 'Pay-as-you-go out of credit',
  7: 'Device starting up',
};

// 0x0202 bit 1: remote ON/OFF control enabled.
export const REMOTE_ON_OFF_MASK = 0x02;

export const REGISTER_LABELS: Record<number, string> = {
  [REG_DEVICE_MODE]: 'Device mode',
  [REG_DEVICE_STATE]: 'Device state',
  [REG_REMOTE_CONTROL_USED]: 'Remote control used',
  [REG_SOLAR_ACTIVITY]: 'Solar activity',
  [REG_LOAD_OFF_REASON]: 'Load off reason',
  [REG_LOAD_OUTPUT_VOLTAGE]: 'Load output voltage',
  [REG_CHARGER_VOLTAGE]: 'Charger voltage',
  [REG_CHARGER_INTERNAL_TEMP]: 'Charger internal temperature',
};

export function registerLabel(register: number): string {
  return REGISTER_LABELS[register] ?? 'Unknown register';
}

export function formatRegisterHex(register: number): string {
  return `0x${register.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Applies the scaling the VE.Direct spec defines for each register.
export function describeRegisterValue(register: number, value: Uint8Array): string {
  switch (register) {
    case REG_CHARGER_INTERNAL_TEMP: {
      const scaledValue = scaled(readIntLE(value, 2), 0.01);
      return scaledValue === null ? 'N/A' : `${scaledValue.toFixed(2)} C`;
    }
    case REG_CHARGER_VOLTAGE:
    case REG_LOAD_OUTPUT_VOLTAGE: {
      const scaledValue = scaled(readUintLE(value), 0.01);
      return scaledValue === null ? 'N/A' : `${scaledValue.toFixed(2)} V`;
    }
    case REG_DEVICE_MODE:
      return describeEnum(readUintLE(value), DEVICE_MODE_LABELS);
    case REG_DEVICE_STATE:
      return describeEnum(readUintLE(value), CHARGE_STATE_LABELS);
    case REG_SOLAR_ACTIVITY:
      return describeEnum(readUintLE(value), SOLAR_ACTIVITY_LABELS);
    case REG_LOAD_OFF_REASON:
      return describeBitmask(readUintLE(value), LOAD_OFF_REASON_BITS, 'None');
    case REG_REMOTE_CONTROL_USED: {
      const mask = readUintLE(value);
      return mask === null ? 'N/A' : (mask & REMOTE_ON_OFF_MASK) !== 0 ? 'On' : 'Off';
    }
    default: {
      const raw = readUintLE(value);
      return raw === null ? 'N/A' : `${raw}`;
    }
  }
}

function parseIntMaybeHex(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const radix = /^0x/i.test(trimmed) ? 16 : 10;
  const parsed = radix === 16 ? parseInt(trimmed.slice(2), 16) : parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function scaled(value: number | null, factor: number): number | null {
  return value === null ? null : value * factor;
}

function textFields(data: Uint8Array): Map<string, string> {
  const fields = new Map<string, string>();
  const text = textDecoder.decode(data);
  for (const line of text.split('\n')) {
    const record = line.endsWith('\r') ? line.slice(0, -1) : line;
    const tab = record.indexOf('\t');
    if (tab > 0) {
      fields.set(record.slice(0, tab), record.slice(tab + 1));
    }
  }
  return fields;
}

export function parseVeDirectTextBlock(data: Uint8Array | null | undefined): VictronTextValues {
  if (!data || data.length === 0) return EMPTY_TEXT_VALUES;
  const f = textFields(data);
  const num = (key: string) => parseIntMaybeHex(f.get(key));
  const load = f.get('LOAD');
  return {
    batteryVoltageV: scaled(num('V'), 0.001),
    batteryCurrentA: scaled(num('I'), 0.001),
    panelVoltageV: scaled(num('VPV'), 0.001),
    panelPowerW: num('PPV'),
    loadOn: load === undefined ? null : load.trim() === 'ON',
    loadCurrentA: scaled(num('IL'), 0.001),
    chargeState: num('CS'),
    mpptMode: num('MPPT'),
    errorCode: num('ERR'),
    offReason: num('OR'),
    yieldTotalKwh: scaled(num('H19'), 0.01),
    yieldTodayKwh: scaled(num('H20'), 0.01),
    maxPowerTodayW: num('H21'),
    yieldYesterdayKwh: scaled(num('H22'), 0.01),
    maxPowerYesterdayW: num('H23'),
  };
}

export interface VictronState {
  textValues: VictronTextValues;
  hexRegs: Map<number, Uint8Array>;
}

export const EMPTY_STATE: VictronState = {
  textValues: EMPTY_TEXT_VALUES,
  hexRegs: new Map(),
};

// TEXT blocks and HEX frames arrive in separate envelopes, so the device state is
// the accumulation of both: the newest TEXT block plus the newest value seen for
// each register.
export function applyEnvelope(
  state: VictronState,
  envelope: victron_smartsolar_mppt.IRxEnvelope,
): VictronState {
  const signal = envelope.signalType ?? 0;
  const textBytes = envelope.data instanceof Uint8Array ? envelope.data : null;
  const hexFrame = envelope.hexFrame instanceof Uint8Array ? envelope.hexFrame : null;

  if (
    signal === victron_smartsolar_mppt.VictronSignalType.VICTRON_TEXT_BLOCK ||
    signal === victron_smartsolar_mppt.VictronSignalType.VICTRON_CONNECTED
  ) {
    return { textValues: parseVeDirectTextBlock(textBytes), hexRegs: state.hexRegs };
  }

  const parsed = hexFrame ? parseVeDirectHexFrame(hexFrame) : null;
  if (!parsed) {
    return state;
  }
  const hexRegs = new Map(state.hexRegs);
  hexRegs.set(parsed.register, parsed.value);
  return { textValues: state.textValues, hexRegs };
}

export interface VictronHexResponse {
  register: number;
  value: Uint8Array;
}

const HEX_RESPONSE_GET = 0x7;
const HEX_RESPONSE_ASYNC = 0xa;

function hexNibble(c: number): number | null {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return null;
}

export function parseVeDirectHexFrame(data: Uint8Array | null | undefined): VictronHexResponse | null {
  if (!data || data.length < 4 || data[0] !== 0x3a) return null;
  const body = data.subarray(1);
  if (body.length % 2 === 0) return null;
  const response = hexNibble(body[0]);
  if (response === null) return null;
  if (response !== HEX_RESPONSE_GET && response !== HEX_RESPONSE_ASYNC) return null;

  const bytes: number[] = [];
  for (let i = 1; i < body.length; i += 2) {
    const hi = hexNibble(body[i]);
    const lo = hexNibble(body[i + 1]);
    if (hi === null || lo === null) return null;
    bytes.push((hi << 4) | lo);
  }

  let sum = response;
  for (const b of bytes) sum = (sum + b) & 0xff;
  if (sum !== 0x55) return null;
  bytes.pop();

  if (bytes.length < 3) return null;
  if (bytes[2] !== 0) return null;
  const register = bytes[0] | (bytes[1] << 8);
  return { register, value: Uint8Array.from(bytes.slice(3)) };
}

// Multiplying rather than shifting keeps 32-bit values out of int32.
export function readUintLE(value: Uint8Array | undefined): number | null {
  if (!value || value.length === 0) return null;
  let result = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    result = result * 256 + value[i];
  }
  return result;
}

// The charger trims trailing zero bytes, so the sign bit sits at the register's
// declared width, not at the width of the bytes that actually arrived.
export function readIntLE(value: Uint8Array | undefined, byteWidth: number): number | null {
  const raw = readUintLE(value);
  if (raw === null) return null;
  const bits = byteWidth * 8;
  return raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
}

export function describeBitmask(
  mask: number | null,
  labels: Record<number, string>,
  none = 'None',
): string {
  if (mask === null) return 'N/A';
  if (mask === 0) return none;
  const set: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (mask & (1 << bit)) set.push(labels[bit] ?? `bit ${bit}`);
  }
  return set.length === 0 ? none : set.join(', ');
}

export function describeEnum(value: number | null, labels: Record<number, string>): string {
  if (value === null) return 'N/A';
  return labels[value] ?? `Unknown (${value})`;
}

export function victronDeviceLabel(
  device: victron_smartsolar_mppt.IVictronDevice | null | undefined,
): string {
  if (!device) return 'Victron SmartSolar';
  return device.deviceSerial || device.portName || device.serialNumber || 'Victron SmartSolar';
}
