export interface ArduinoNiclaSenseEnvMainValues {
  temperatureC: number | null;
  humidityPercent: number | null;
  epaAqi: number | null;
  iaq: number | null;
  tvocMgM3: number | null;
  eco2Ppm: number | null;
}

function hasRange(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function viewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function f32le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 4) ? viewFor(bytes).getFloat32(offset, true) : null;
}

function u16le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 2) ? viewFor(bytes).getUint16(offset, true) : null;
}

export function readArduinoNiclaSenseEnvMainValues(
  data: Uint8Array | null | undefined,
): ArduinoNiclaSenseEnvMainValues {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array();
  return {
    temperatureC: f32le(bytes, 0x18),
    humidityPercent: f32le(bytes, 0x1c),
    epaAqi: u16le(bytes, 0x28),
    iaq: f32le(bytes, 0x70),
    tvocMgM3: f32le(bytes, 0x74),
    eco2Ppm: f32le(bytes, 0x78),
  };
}
