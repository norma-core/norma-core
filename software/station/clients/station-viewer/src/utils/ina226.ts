export const INA226_CONFIG_REGISTER = 0x00;
export const INA226_SHUNT_REGISTER = 0x01;
export const INA226_BUS_REGISTER = 0x02;
export const INA226_MANUFACTURER_ID_REGISTER = 0x0e;
export const INA226_DIE_ID_REGISTER = 0x0f;

export const INA226_DUMP_REGISTERS: number[] = [
  INA226_CONFIG_REGISTER,
  INA226_SHUNT_REGISTER,
  INA226_BUS_REGISTER,
  0x03,
  0x04,
  0x05,
  0x06,
  0x07,
  INA226_MANUFACTURER_ID_REGISTER,
  INA226_DIE_ID_REGISTER,
];

export const INA226_SHUNT_VOLTAGE_LSB_MV = 0.0025;
export const INA226_BUS_VOLTAGE_LSB_V = 0.00125;

const INA226_REGISTER_LENGTH = 2;

export interface FormattedIna226Current {
  value: string;
  unit: string;
  text: string;
}

function formatSignedFixed(value: number, decimals: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

export function toSigned16(word: number): number {
  return word & 0x8000 ? word - 0x10000 : word;
}

export function readIna226Word(bytes: Uint8Array | null | undefined, register: number): number | null {
  const index = INA226_DUMP_REGISTERS.indexOf(register);
  if (!bytes || index < 0) {
    return null;
  }

  const offset = index * INA226_REGISTER_LENGTH;
  if (offset + INA226_REGISTER_LENGTH > bytes.length) {
    return null;
  }

  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readIna226SignedWord(bytes: Uint8Array | null | undefined, register: number): number | null {
  const word = readIna226Word(bytes, register);
  return word === null ? null : toSigned16(word);
}

export function readIna226ShuntMillivolts(bytes: Uint8Array | null | undefined): number | null {
  const raw = readIna226SignedWord(bytes, INA226_SHUNT_REGISTER);
  return raw === null ? null : raw * INA226_SHUNT_VOLTAGE_LSB_MV;
}

export function calculateIna226CurrentAmps(
  shuntMillivolts: number | null,
  shuntResistanceOhms: number | null | undefined,
): number | null {
  if (
    shuntMillivolts === null ||
    !Number.isFinite(shuntMillivolts) ||
    shuntResistanceOhms === null ||
    shuntResistanceOhms === undefined ||
    !Number.isFinite(shuntResistanceOhms) ||
    shuntResistanceOhms <= 0
  ) {
    return null;
  }
  return (shuntMillivolts / 1000) / shuntResistanceOhms;
}

export function readIna226CurrentAmps(
  bytes: Uint8Array | null | undefined,
  shuntResistanceOhms: number | null | undefined,
): number | null {
  return calculateIna226CurrentAmps(readIna226ShuntMillivolts(bytes), shuntResistanceOhms);
}

export function formatIna226Current(currentAmps: number | null): FormattedIna226Current {
  if (currentAmps === null || !Number.isFinite(currentAmps)) {
    return { value: 'N/A', unit: '', text: 'N/A' };
  }

  const abs = Math.abs(currentAmps);
  if (abs === 0 || abs >= 1) {
    const value = formatSignedFixed(currentAmps, 3);
    return { value, unit: 'A', text: `${value} A` };
  }
  if (abs >= 0.001) {
    const value = formatSignedFixed(currentAmps * 1000, 3);
    return { value, unit: 'mA', text: `${value} mA` };
  }
  if (abs >= 0.000001) {
    const value = formatSignedFixed(currentAmps * 1_000_000, 2);
    return { value, unit: 'uA', text: `${value} uA` };
  }

  const value = formatSignedFixed(currentAmps * 1_000_000_000, 2);
  return { value, unit: 'nA', text: `${value} nA` };
}

export function readIna226BusVolts(bytes: Uint8Array | null | undefined): number | null {
  const word = readIna226Word(bytes, INA226_BUS_REGISTER);
  return word === null ? null : word * INA226_BUS_VOLTAGE_LSB_V;
}
