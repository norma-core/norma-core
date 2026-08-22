import { airgradient_open_air_o_1pst } from '@/api/proto.js';

export interface AirGradientValues {
  pm1: number | null;
  pm25: number | null;
  pm10: number | null;
  temperatureC: number | null;
  humidityPercent: number | null;
  co2Ppm: number | null;
  vocIndex: number | null;
  noxIndex: number | null;
}

const EMPTY_VALUES: AirGradientValues = {
  pm1: null,
  pm25: null,
  pm10: null,
  temperatureC: null,
  humidityPercent: null,
  co2Ppm: null,
  vocIndex: null,
  noxIndex: null,
};

const textDecoder = new TextDecoder();

function opt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractJson(line: string): string | null {
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  return start >= 0 && end > start ? line.slice(start, end + 1) : null;
}

// The firmware prints `nan`/`inf` for not-yet-ready sensors (SGP41 warm-up),
// which is invalid JSON. Replace those tokens with `null` before parsing.
function sanitizeNonFinite(json: string): string {
  return json.replace(/-?\b(?:nan|inf)\b/gi, 'null');
}

// The driver forwards the full raw serial line as bytes; the JSON is parsed here.
export function airGradientLineText(data: Uint8Array | null | undefined): string {
  return data && data.length > 0 ? textDecoder.decode(data) : '';
}

export function readAirGradientValues(
  data: Uint8Array | null | undefined,
): AirGradientValues {
  const json = extractJson(airGradientLineText(data));
  if (!json) {
    return EMPTY_VALUES;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(sanitizeNonFinite(json)) as Record<string, unknown>;
  } catch {
    return EMPTY_VALUES;
  }
  return {
    pm1: opt(raw.pm1_0),
    pm25: opt(raw.pm2_5),
    pm10: opt(raw.pm10_0),
    temperatureC: opt(raw.temp_c),
    humidityPercent: opt(raw.humidity),
    co2Ppm: opt(raw.co2),
    vocIndex: opt(raw.voc_index),
    noxIndex: opt(raw.nox_index),
  };
}

export function airGradientDeviceLabel(
  device: airgradient_open_air_o_1pst.IAirGradientDevice | null | undefined,
): string {
  if (!device) {
    return 'AirGradient';
  }
  return device.deviceId || device.portName || device.serialNumber || device.product || 'AirGradient';
}
