import type { hikmicro } from '@/api/proto.js';

const SENSOR_WIDTH = 256;
const SENSOR_HEIGHT = 192;
const PIXEL_COUNT = SENSOR_WIDTH * SENSOR_HEIGHT;
const Y16_BYTES = PIXEL_COUNT * 2;
const APPEND_BYTES = 2048;
const FACTORY_BLOB_BYTES = 0x3800;
const RESP_INV_NUMERATOR = 70368744177664;
const KELVIN_OFFSET_Q8 = 0x11126;
const KELVIN_OFFSET_Q12 = 0x111266;

export interface ThermalRenderResult {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  minC: number | null;
  maxC: number | null;
  centerC: number | null;
  avgC: number | null;
  minRaw: number;
  maxRaw: number;
  centerRaw: number;
  usedCalibration: boolean;
  error: string | null;
}

interface TemperatureState {
  selector: number;
  range: number;
  mode: number;
  sensorType: number;
  t104: number;
  t108: number;
  t10c: number;
  t110: number;
  t114: number;
  rise: number;
  envDc: number;
  humidity: number;
  distance: number;
  optical: number;
  emissivity: number;
  reflected: number;
  resp1: number;
  resp2: number;
  r: number;
  b: number;
  o: number;
  f: number;
  calibBase: number;
  curBase: number;
  hep: number;
  zero: number;
  outOpt: number;
  atmTransQ14: number;
  objCombinedTransQ14: number;
  objQuadCoeff: number;
  objRadOffset: number;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function le16(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint16(offset, true);
}

function le32u(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint32(offset, true);
}

function le32s(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getInt32(offset, true);
}

function le64s(bytes: Uint8Array, offset: number): number {
  return Number(dataView(bytes).getBigInt64(offset, true));
}

function toInt16(value: number): number {
  const wrapped = ((Math.trunc(value) % 0x10000) + 0x10000) % 0x10000;
  return wrapped >= 0x8000 ? wrapped - 0x10000 : wrapped;
}

function truncDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

function shiftRight(value: number, bits: number): number {
  const divisor = 2 ** bits;
  return value >= 0 ? Math.trunc(value / divisor) : Math.floor(value / divisor);
}

function calI32(calib: Uint8Array, offset: number): number {
  if (offset + 4 > calib.length) {
    throw new Error('calibration offset out of range');
  }
  return le32s(calib, offset);
}

function calU32(calib: Uint8Array, offset: number): number {
  if (offset + 4 > calib.length) {
    throw new Error('calibration offset out of range');
  }
  return le32u(calib, offset);
}

function calI64(calib: Uint8Array, offset: number): number {
  if (offset + 8 > calib.length) {
    throw new Error('calibration offset out of range');
  }
  return le64s(calib, offset);
}

function calIdxI32(calib: Uint8Array, idx: number): number {
  return calI32(calib, idx * 4);
}

function calIdxU32(calib: Uint8Array, idx: number): number {
  return calU32(calib, idx * 4);
}

function calIdxI64(calib: Uint8Array, idx: number): number {
  return calI64(calib, idx * 4);
}

function signed14ToU16(value: number): number {
  const mag = value & 0x3fff;
  if (((value >> 13) & 1) === 0) {
    return mag;
  }
  return (0x2000 - mag) & 0xffff;
}

function expResponseQ8(xQ14: number): number {
  return Math.trunc(Math.exp(xQ14 / 16384.0) * 256.0);
}

function microtaSensorType(raw: number): number {
  const map = [
    0xa0, 0xb1, 0xb2, 0xb0, 0x10, 0x20, 0x21, 0x30, 0x21, 0x40,
    0x21, 0x21, 0x51, 0x50, 0x52, 0x21, 0x53, 0x50, 0x54, 0x21,
    0x21, 0x21, 0x55, 0x21, 0x21, 0x21, 0x21, 0x21, 0x21, 0x21,
    0x21, 0x21, 0x21, 0x21, 0x57,
  ];
  const idx = raw - 0xb0;
  if (idx >= 0 && idx < map.length && Math.floor(0x4004772ff / (2 ** idx)) % 2 !== 0) {
    return map[idx];
  }
  return raw;
}

function uint32(value: number): number {
  return ((Math.trunc(value) % 0x100000000) + 0x100000000) % 0x100000000;
}

function createDefaultState(): TemperatureState {
  return {
    selector: 0,
    range: 0,
    mode: 1,
    sensorType: 0x53,
    t104: 0,
    t108: 0,
    t10c: 0,
    t110: 0,
    t114: 0,
    rise: 0,
    envDc: 1000,
    humidity: 50,
    distance: 100,
    optical: 2441,
    emissivity: 950,
    reflected: 20000,
    resp1: 0,
    resp2: 0,
    r: 0,
    b: 0,
    o: 0,
    f: 0,
    calibBase: 0,
    curBase: 0,
    hep: 0,
    zero: 0,
    outOpt: 0,
    atmTransQ14: 0,
    objCombinedTransQ14: 0,
    objQuadCoeff: 0x0f85,
    objRadOffset: 0,
  };
}

function setAddl1(state: TemperatureState, calib: Uint8Array, addl: Uint8Array): void {
  const calLo = calI32(calib, 0x2b10);
  const calHi = calI32(calib, 0x2b14);
  const slope = toInt16(calLo);
  const base = toInt16(calHi);

  const val = (i: number): number => {
    const v = signed14ToU16(le16(addl, i * 2));
    return toInt16(base + toInt16(v * slope));
  };

  state.t104 = val(0);
  state.t10c = val(1);
  state.t110 = calHi + signed14ToU16(le16(addl, 2 * 2)) * calLo;
  state.mode = le16(addl, 5 * 2) & 0x3fff;
  state.range = le16(addl, 13 * 2) & 0x3fff;
  state.t114 = val(0x14);
  state.t108 = val(0x1b);

  const lo = calI32(calib, 0x2bd0);
  const hi = calI32(calib, 0x2bc0);
  const diff = state.t10c - state.envDc;
  const v = Math.max(lo, diff);
  state.rise = v <= hi ? v : hi;
}

function calcRealResponse(state: TemperatureState, calib: Uint8Array): void {
  const selector = state.selector;
  const range = state.range;
  const mode = state.mode;
  const cal0 = calIdxU32(calib, 0);
  const u23 = calIdxI32(calib, selector * 0x19 + range * 5 + mode + 0x9b);
  const u6 = calIdxI32(calib, selector * 0xe1 + range * 0x2d + mode * 9 + 0x33e);
  const u7 = calIdxI32(calib, selector * 0xe1 + range * 0x2d + mode * 9 + 0x33f);

  let l15 = 0;
  let l17 = 0x100000000;
  if ((calIdxU32(calib, 2) & 0xfffffff8) === 0x50) {
    const d = state.t10c - u23;
    let dScaled: number;
    let denomQuad: number;
    let denomLin: number;
    if (Math.abs(d) < 0x2ef) {
      dScaled = d * 2;
      denomLin = 1000000;
      denomQuad = 1000000000000;
    } else {
      dScaled = truncDiv(d, 10);
      denomLin = 50000;
      denomQuad = 2500000000;
    }
    const d2 = dScaled * dScaled;
    const q1 = truncDiv(d2 * calIdxI64(calib, range * 0x50 + mode * 0x10 + 0x936), denomQuad);
    const l1 = truncDiv(calIdxI64(calib, range * 0x50 + mode * 0x10 + 0x934) * dScaled, denomLin);
    const q2 = truncDiv(d2 * calIdxI64(calib, range * 0x50 + mode * 0x10 + 0x93a), denomQuad);
    const l2 = truncDiv(calIdxI64(calib, range * 0x50 + mode * 0x10 + 0x938) * dScaled, denomLin);
    l17 = q1 + l1 + 0x100000000;
    l15 = q2 + l2;
  }
  if (l15 + 0x1ff <= 0x3fe) {
    l15 = 0;
  }
  state.resp1 = l17;
  state.resp2 = l15;

  const u8 = calIdxI32(calib, range * 0x55 + mode * 0x11 + 0x195);
  const b = calIdxI32(calib, range * 0x55 + mode * 0x11 + 0x196);
  const u9 = calIdxI32(calib, range * 0x55 + mode * 0x11 + 0x197);
  const f = calIdxI32(calib, range * 0x55 + mode * 0x11 + 0x198);
  state.b = b;
  state.f = f;

  const denomArg = u23 * 20 + 0x42afe;
  const div = truncDiv(b * 1000, denomArg);
  const expv = expResponseQ8(div);
  const denom = expv - (cal0 < 0x403 ? 0x100 : f);
  const l17b = shiftRight(u8 * u7, 20);
  const i16 = shiftRight(u9 * u7 + u6 * 0x1000, 20);
  const rPart = denom ? truncDiv(l17b, denom) : 0;
  const oPart = i16 >= 0 ? i16 : i16 + 0xff;
  const calibBase = rPart + shiftRight(oPart, 8);
  state.calibBase = calibBase;

  const optTrans = Math.max(10, calI32(calib, 0x2b18));
  const emissScaled = truncDiv(state.emissivity * 1000, optTrans);
  const rMul = l17b * emissScaled;
  const oMul = emissScaled * (i16 - calibBase * 0x100);
  state.r = truncDiv(rMul, 1000);
  state.o = truncDiv(oMul, 1000);
}

function compensateOutOpt(
  calibOptTemp: number,
  calibTrans: number,
  curOptTemp: number,
  curTrans: number,
  calibCavTemp: number,
  state: TemperatureState,
  calib: Uint8Array,
): number {
  const clampTrans = (v: number) => Math.max(10, Math.min(1000, v));
  calibTrans = clampTrans(calibTrans);
  curTrans = clampTrans(curTrans);
  const rad4 = (t: number): number => {
    const k = t * 20 + 0x42afe;
    const sq = truncDiv(k * k, 1000);
    return truncDiv(sq * sq, 1000);
  };
  const calibCavRad = rad4(calibCavTemp);
  const calibOptRad = rad4(calibOptTemp);
  const curOptRad = rad4(curOptTemp);
  let calibMix = Math.trunc(Math.sqrt(calibOptRad * (1000 - calibTrans) + calibCavRad * calibTrans));
  calibMix = Math.trunc(Math.sqrt(calibMix * 1000));
  let curMix = Math.trunc(Math.sqrt(curOptRad * (1000 - curTrans) + calibCavRad * curTrans));
  curMix = Math.trunc(Math.sqrt(curMix * 1000));
  if (calibMix <= 0 || curMix <= 0) {
    return 0;
  }
  const denomFor = (mix: number): number => {
    const arg = truncDiv(state.b * 1000, mix);
    const e = expResponseQ8(arg);
    return e - (calIdxU32(calib, 0) < 0x403 ? 0x100 : state.f);
  };
  const d1 = denomFor(calibMix);
  const d2 = denomFor(curMix);
  if (d1 === 0 || d2 === 0) {
    return 0;
  }
  const o1 = state.o >= 0 ? state.o : state.o + 0xff;
  const o2 = state.o >= 0 ? state.o : state.o + 0xff;
  const a = truncDiv(state.r, d1) + shiftRight(o1, 8);
  const b = truncDiv(state.r, d2) + shiftRight(o2, 8);
  return curTrans ? truncDiv((-a + b) * 1000, curTrans) : 0;
}

function calcBaseGray(state: TemperatureState, calib: Uint8Array): void {
  const range = state.range;
  const mode = state.mode;
  const cal0 = calIdxU32(calib, 0);
  const curCav = state.t10c;
  const calibCav = calIdxI32(calib, range * 0x19 + mode + 0x9b);
  const riseRef = calIdxI32(calib, range * 0x19 + mode + 0x118);
  const hepCurve = calIdxI32(calib, range * 0x19 + mode + 0xaf7);
  const arg = truncDiv(state.b * 1000, curCav * 20 + 0x42afe);
  const expv = expResponseQ8(arg);
  const denom = expv - (cal0 < 0x403 ? 0x100 : state.f);
  const invR = denom ? truncDiv(state.r, denom) : 0;
  const oAdj = state.o >= 0 ? state.o : state.o + 0xff;
  const l15 = invR + shiftRight(oAdj, 8);
  const deltaCav = shiftRight((state.resp1 + state.resp2 * l15) * l15, 32);
  const baseGray = state.calibBase -
    shiftRight(
      (
        truncDiv(calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a7) * (curCav - calibCav), 0x32) +
        calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a3)
      ) * deltaCav,
      14,
    );

  let hepDiff = 0;
  if (cal0 < 0x405) {
    const u16 = calibCav - riseRef;
    const l19 = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a4);
    const l15c = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a5);
    const l18 = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a6);
    const curRise = state.rise;
    if (u16 * 0x4000 < l19 * 0x32) {
      if (curRise * 0x4000 >= l19 * 0x32) {
        hepDiff = shiftRight(truncDiv(l18 * curRise - l15c * u16, 0x32), 14) +
          shiftRight((l15c - l18) * l19, 28);
      } else {
        hepDiff = shiftRight(truncDiv((curRise - u16) * l15c, 0x32), 14);
      }
    } else if (curRise * 0x4000 >= l19 * 0x32) {
      hepDiff = shiftRight(truncDiv((curRise - u16) * l18, 0x32), 14);
    } else {
      hepDiff = shiftRight(truncDiv(l15c * curRise - l18 * u16, 0x32), 14) +
        shiftRight((l18 - l15c) * l19, 28);
    }
  } else {
    const u27 = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a5);
    const u28 = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a6);
    const u26 = calibCav - hepCurve;
    const u14 = curCav - state.t108;
    const d = u14 - u26;
    const tmp = truncDiv(u27 * d, 0x32) + truncDiv(d * d * u28, 0x9c4);
    const i9 = shiftRight(tmp, 14);
    hepDiff = shiftRight(state.resp1 * i9 + state.resp2 * uint32(i9 * i9), 32);
  }

  const zeroCoeff = calIdxI32(calib, range * 0x28 + mode * 8 + 0x7a9);
  const zeroMul = zeroCoeff * (state.t10c - state.t114);
  let zero = 0;
  if (zeroMul < 0x1d588000) {
    zero = -0x1d4c0032 < zeroMul ? truncDiv(zeroMul, 100000) : -600;
  } else {
    zero = 600;
  }

  const curOptTemp = truncDiv(state.optical, 20);
  const calibOptTrans = Math.max(10, calI32(calib, 0x2b18));
  const curOptTrans = state.emissivity;
  const calibOptTemp = calibCav - truncDiv(hepDiff < 0 ? hepDiff + 1 : hepDiff, 2);
  const optDiff = compensateOutOpt(
    calibOptTemp,
    calibOptTrans,
    curOptTemp,
    curOptTrans,
    calibCav,
    state,
    calib,
  );
  const optCurve = shiftRight((state.resp1 + state.resp2 * optDiff) * optDiff, 32);

  state.curBase = (baseGray - hepDiff - zero) + optCurve;
  state.hep = hepDiff;
  state.zero = zero;
  state.outOpt = optCurve;
}

function precomputeObject(state: TemperatureState, atmTransQ14: number): void {
  state.atmTransQ14 = atmTransQ14;
  const combined = shiftRight(
    shiftRight(state.emissivity * 0x10624dd3000, 0x26) * atmTransQ14,
    12,
  );
  const envK = truncDiv(state.envDc * 4096, 0x32) + KELVIN_OFFSET_Q12;
  const reflK = truncDiv(state.reflected * 4096, 1000) + KELVIN_OFFSET_Q12;
  const env2 = shiftRight(envK * envK, 12);
  const refl2 = shiftRight(reflK * reflK, 12);
  const env4 = shiftRight(env2 * env2, 12);
  const refl4 = shiftRight(refl2 * refl2, 12);
  let radOffset = shiftRight(env4 * 0x7b, 12);
  radOffset -= shiftRight(env4 * (0x4000 - atmTransQ14) + refl4 * (atmTransQ14 - combined), 14);
  state.objCombinedTransQ14 = combined;
  state.objQuadCoeff = 0x0f85;
  state.objRadOffset = radOffset;
}

function buildState(calib: Uint8Array, addl: Uint8Array): TemperatureState {
  if (calib.length !== FACTORY_BLOB_BYTES) {
    throw new Error(`expected calibration blob size 0x3800, got ${calib.length}`);
  }
  if (addl.length !== APPEND_BYTES) {
    throw new Error(`expected ${APPEND_BYTES}-byte runtime block`);
  }
  const state = createDefaultState();
  const sideOffset = SENSOR_WIDTH * 2;
  const marker = le32u(addl, sideOffset);
  const rawSensor = le32u(addl, sideOffset + 4);
  state.sensorType = microtaSensorType(rawSensor);
  if (marker !== 0xaabbccdd || state.sensorType !== calU32(calib, 8)) {
    throw new Error('unexpected runtime marker or sensor type');
  }
  setAddl1(state, calib, addl);
  calcRealResponse(state, calib);
  calcBaseGray(state, calib);
  precomputeObject(state, 15821);
  return state;
}

function blackbodyCQ12FromGray(state: TemperatureState, gray: number): number {
  const delta = gray - state.curBase;
  let compensated: number;
  if (state.resp2 < 0x200) {
    const inv = Math.trunc(RESP_INV_NUMERATOR / state.resp1);
    compensated = shiftRight(delta * inv, 14);
  } else {
    const a = state.resp2 * 4.0;
    const b = shiftRight(state.resp1, 5);
    const root = Math.sqrt(b * b + delta * a);
    compensated = Math.trunc(
      (root - state.resp1) * (4294967296.0 / state.resp2) / (2 ** 33),
    );
  }

  const denom = compensated * 256.0 - state.o;
  const numer = state.r - shiftRight(state.f * state.o, 8) + state.f * compensated;
  const logArg = numer / denom;
  const c = (state.b / 16384.0) / Math.log(logArg) - (KELVIN_OFFSET_Q8 / 256.0);
  return Math.trunc(c * 4096.0);
}

function objectCQ6FromBbQ12(state: TemperatureState, bbCQ12: number): number {
  const k = bbCQ12 + KELVIN_OFFSET_Q12;
  const k2 = shiftRight(k * k, 12);
  const rad = state.objRadOffset + shiftRight(state.objQuadCoeff * shiftRight(k2 * k2, 12), 12);
  const inv = 0x4000000 / state.objCombinedTransQ14;
  const x = shiftRight(inv * rad, 12);
  const r1 = Math.trunc(Math.sqrt(x));
  const r2 = Math.trunc(Math.sqrt(r1 * 64));
  const objCQ8 = r2 * 4 - KELVIN_OFFSET_Q8;
  return shiftRight(objCQ8, 2);
}

function calibrationBlob(deviceInfo: hikmicro.IDeviceInfo | null | undefined): Uint8Array | null {
  const calibration = deviceInfo?.calibration;
  const container = calibration?.container;
  if (!calibration?.ok || !container || container.length === 0) {
    return null;
  }

  const offset = calibration.factoryBlobOffset ?? 0;
  const length = calibration.factoryBlobLength ?? 0;
  if (length === FACTORY_BLOB_BYTES && offset >= 0 && offset + length <= container.length) {
    return container.slice(offset, offset + length);
  }

  if (container.length === FACTORY_BLOB_BYTES) {
    return container;
  }

  return null;
}

function y16Plane(payload: Uint8Array): Uint16Array {
  if (payload.length < Y16_BYTES) {
    throw new Error(`short HIKMICRO payload: ${payload.length} bytes`);
  }
  const view = dataView(payload);
  const values = new Uint16Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    values[i] = view.getUint16(i * 2, true);
  }
  return values;
}

function runtimeBlock(payload: Uint8Array): Uint8Array {
  if (payload.length < Y16_BYTES + APPEND_BYTES) {
    throw new Error(`short HIKMICRO runtime block: ${payload.length} bytes`);
  }
  return payload.slice(Y16_BYTES, Y16_BYTES + APPEND_BYTES);
}

function temperatureMap(y16: Uint16Array, state: TemperatureState): Float32Array {
  const values = new Float32Array(y16.length);
  for (let i = 0; i < y16.length; i += 1) {
    const bb = blackbodyCQ12FromGray(state, y16[i]);
    const obj = objectCQ6FromBbQ12(state, bb);
    values[i] = obj / 64.0;
  }
  return values;
}

function rawMap(y16: Uint16Array): Float32Array {
  const values = new Float32Array(y16.length);
  for (let i = 0; i < y16.length; i += 1) {
    values[i] = y16[i];
  }
  return values;
}

function finiteStats(values: Float32Array): {
  min: number | null;
  max: number | null;
  avg: number | null;
  center: number | null;
} {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
  }

  const center = values[(SENSOR_HEIGHT >> 1) * SENSOR_WIDTH + (SENSOR_WIDTH >> 1)];
  return {
    min: count > 0 ? min : null,
    max: count > 0 ? max : null,
    avg: count > 0 ? sum / count : null,
    center: Number.isFinite(center) ? center : null,
  };
}

function rawStats(y16: Uint16Array): { min: number; max: number; center: number } {
  let min = 0xffff;
  let max = 0;
  for (const value of y16) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    min,
    max,
    center: y16[(SENSOR_HEIGHT >> 1) * SENSOR_WIDTH + (SENSOR_WIDTH >> 1)],
  };
}

function palette(value: number, lo: number, hi: number): [number, number, number] {
  const span = hi > lo ? hi - lo : 1;
  const g = Math.max(0, Math.min(1, (value - lo) / span));
  const r = Math.min(1, 4 * g);
  const y = Math.max(0, Math.min(1, 4 * (g - 0.25)));
  const w = Math.max(0, Math.min(1, 4 * (g - 0.75)));
  return [
    Math.round(Math.max(0, Math.min(255, (0.35 + 0.65 * r) * 255))),
    Math.round(Math.max(0, Math.min(255, (0.08 * r + 0.70 * y + 0.22 * w) * 255))),
    Math.round(Math.max(0, Math.min(255, (0.04 * r + 0.20 * w) * 255))),
  ];
}

function toRgba(values: Float32Array, lo: number, hi: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const [r, g, b] = Number.isFinite(value) ? palette(value, lo, hi) : [0, 0, 0];
    const j = i * 4;
    rgba[j] = r;
    rgba[j + 1] = g;
    rgba[j + 2] = b;
    rgba[j + 3] = 255;
  }
  return rgba;
}

export function renderThermalFrame(
  envelope: hikmicro.IRxEnvelope,
  frame: hikmicro.IThermalFrame,
): ThermalRenderResult {
  let error: string | null = null;
  const payload = frame.payload ?? new Uint8Array();
  const y16 = y16Plane(payload);
  const raw = rawStats(y16);

  let map: Float32Array;
  let usedCalibration = false;
  const blob = calibrationBlob(envelope.deviceInfo);
  if (blob) {
    try {
      const state = buildState(blob, runtimeBlock(payload));
      map = temperatureMap(y16, state);
      usedCalibration = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'temperature conversion failed';
      map = rawMap(y16);
    }
  } else {
    error = envelope.deviceInfo?.calibration?.error || 'missing HIKMICRO calibration blob';
    map = rawMap(y16);
  }

  const stats = finiteStats(map);
  const lo = stats.min ?? 0;
  const hi = stats.max ?? lo + 1;

  return {
    width: SENSOR_WIDTH,
    height: SENSOR_HEIGHT,
    rgba: toRgba(map, lo, hi),
    minC: usedCalibration ? stats.min : null,
    maxC: usedCalibration ? stats.max : null,
    centerC: usedCalibration ? stats.center : null,
    avgC: usedCalibration ? stats.avg : null,
    minRaw: raw.min,
    maxRaw: raw.max,
    centerRaw: raw.center,
    usedCalibration,
    error,
  };
}

export function latestThermalFrame(
  envelope: hikmicro.IRxEnvelope,
): hikmicro.IThermalFrame | null {
  const frames = envelope.frames?.frames ?? [];
  return frames.length > 0 ? frames[frames.length - 1] : null;
}

export function hikmicroDeviceLabel(envelope: hikmicro.IRxEnvelope, queueId: string): string {
  const usb = envelope.deviceInfo?.usb;
  if (usb?.product || usb?.serialNumber) {
    return [usb.product, usb.serialNumber].filter(Boolean).join(' ');
  }
  if (usb?.uniqueId) {
    return usb.uniqueId;
  }
  return queueId;
}

export function formatCelsius(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(1)} C`;
}
