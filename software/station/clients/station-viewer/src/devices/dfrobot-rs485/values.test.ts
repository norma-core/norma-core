import { describe, expect, it } from 'vitest';
import { dfrobot_rs485 } from '@/api/proto.js';
import {
  DFROBOT_SPECS,
  commandIdMatches,
  decodeDfrobotRegisters,
  dfrobotCommsProfile,
  dfrobotPrimaryText,
  planDfrobotConfigWrites,
  readDfrobotValue,
  readDfrobotWord,
} from './values';

const { DfrobotSensorModel } = dfrobot_rs485;

function range(startRegister: number, words: number[]): dfrobot_rs485.IRegisterRange {
  const data = new Uint8Array(words.length * 2);
  words.forEach((word, i) => {
    data[i * 2] = (word >> 8) & 0xff;
    data[i * 2 + 1] = word & 0xff;
  });
  return { startRegister, data };
}

describe('readDfrobotWord', () => {
  it('finds a register inside a stored range', () => {
    const ranges = [range(0x07d0, [1, 2, 0, 0x1234, 0x5678])];
    expect(readDfrobotWord(ranges, 0x07d0)).toBe(1);
    expect(readDfrobotWord(ranges, 0x07d3)).toBe(0x1234);
    expect(readDfrobotWord(ranges, 0x07d5)).toBeNull();
    expect(readDfrobotWord(ranges, 0x0000)).toBeNull();
  });

  it('handles missing or truncated data', () => {
    expect(readDfrobotWord([], 0x0000)).toBeNull();
    expect(readDfrobotWord([{ startRegister: 0, data: new Uint8Array([0x01]) }], 0x0000)).toBeNull();
  });
});

describe('scaling (hardware-verified worked examples from REGISTERS.md)', () => {
  it('uv intensity: raw 323 => 3.23 mW/cm²', () => {
    const spec = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0642_UV]
      .find((s) => s.name === 'uv_intensity')!;
    expect(readDfrobotValue([range(0x0000, [323, 0])], spec)).toBeCloseTo(3.23);
  });

  it('par is ×1 (the kit doc ×0.1 is wrong): raw 100 => 100 µmol/m²·s', () => {
    const spec = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0641_PAR]
      .find((s) => s.name === 'par')!;
    expect(readDfrobotValue([range(0x0000, [100, 0, 0, 0])], spec)).toBe(100);
  });

  it('light is 32-bit across 0x0002/0x0003: hi=4 lo=21814 => 283.958 Lux', () => {
    const spec = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0644_LIGHT]
      .find((s) => s.name === 'illuminance')!;
    expect(readDfrobotValue([range(0x0002, [4, 21814])], spec))
      .toBeCloseTo((4 * 65536 + 21814) / 1000);
  });

  it('signed setting: par deviation 0xFFFF => -1', () => {
    const spec = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0641_PAR]
      .find((s) => s.name === 'deviation')!;
    expect(readDfrobotValue([range(0x0052, [0xffff])], spec)).toBe(-1);
  });
});

describe('decodeDfrobotRegisters', () => {
  it('splits known and unknown registers', () => {
    const ranges = [range(0x0000, [323, 5]), range(0x0099, [0xbeef])];
    const { known, unknown } = decodeDfrobotRegisters(
      DfrobotSensorModel.DFROBOT_SEN0642_UV,
      ranges,
    );
    expect(known.some((k) => k.spec.name === 'uv_intensity' && k.value === 3.23)).toBe(true);
    expect(known.some((k) => k.spec.name === 'uv_index' && k.value === 5)).toBe(true);
    expect(unknown).toEqual([{ register: 0x0099, raw: 0xbeef }]);
  });

  it('does not report the lux low word as unknown (consumed by the 32-bit spec)', () => {
    const { unknown } = decodeDfrobotRegisters(
      DfrobotSensorModel.DFROBOT_SEN0644_LIGHT,
      [range(0x0002, [4, 21814])],
    );
    expect(unknown).toEqual([]);
  });
});

describe('dfrobotPrimaryText', () => {
  it('formats each model', () => {
    expect(dfrobotPrimaryText(DfrobotSensorModel.DFROBOT_SEN0640_IRRADIANCE, [range(0x0000, [412, 0])]))
      .toBe('412 W/m²');
    expect(dfrobotPrimaryText(DfrobotSensorModel.DFROBOT_SEN0642_UV, [range(0x0000, [210, 5])]))
      .toBe('2.10 mW/cm² · UVI 5');
    expect(dfrobotPrimaryText(DfrobotSensorModel.DFROBOT_SEN0640_IRRADIANCE, [])).toBe('N/A');
  });
});

describe('static register specs', () => {
  it('decodes range_max per model with model-native scaling', () => {
    const irr = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0640_IRRADIANCE]
      .find((s) => s.name === 'range_max')!;
    expect(readDfrobotValue([range(0x083b, [1800])], irr)).toBe(1800);
    expect(irr.unit).toBe('W/m²');

    const uv = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0642_UV]
      .find((s) => s.name === 'range_max')!;
    expect(readDfrobotValue([range(0x083b, [1500])], uv)).toBeCloseTo(15.0);

    const par = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0641_PAR]
      .find((s) => s.name === 'range_max')!;
    expect(readDfrobotValue([range(0x083b, [2500])], par)).toBe(2500);
  });

  it('names the factory reset magic and 0x0830-block registers', () => {
    const specs = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0641_PAR];
    expect(specs.some((s) => s.name === 'factory_reset_magic' && s.register === 0x00f0)).toBe(true);
    for (const register of [0x0834, 0x0837, 0x0839, 0x0840, 0x0841, 0x0842, 0x0844, 0x0849]) {
      expect(specs.some((s) => s.register === register)).toBe(true);
    }
  });

  it('uv keeps 0x0010 named so a live value does not show as unmapped', () => {
    const specs = DFROBOT_SPECS[DfrobotSensorModel.DFROBOT_SEN0642_UV];
    expect(specs.some((s) => s.register === 0x0010)).toBe(true);
  });
});

describe('dfrobotCommsProfile', () => {
  const Model = dfrobot_rs485.DfrobotSensorModel;

  it('maps the radiation family to 0x07D0/0x07D1 with immediate effect', () => {
    for (const model of [
      Model.DFROBOT_SEN0640_IRRADIANCE,
      Model.DFROBOT_SEN0641_PAR,
      Model.DFROBOT_SEN0642_UV,
    ]) {
      const profile = dfrobotCommsProfile(model);
      expect(profile).toEqual({
        addressRegister: 0x07d0,
        baudRegister: 0x07d1,
        baudToCode: { 2400: 0, 4800: 1, 9600: 2 },
        latchesOnPowerCycle: false,
      });
    }
  });

  it('maps the light sensor to 0x0064/0x0065 with power-cycle latch', () => {
    const profile = dfrobotCommsProfile(Model.DFROBOT_SEN0644_LIGHT);
    expect(profile).toEqual({
      addressRegister: 0x0064,
      baudRegister: 0x0065,
      baudToCode: { 1200: 0, 2400: 1, 4800: 2, 9600: 3, 19200: 4, 38400: 5, 57600: 6 },
      latchesOnPowerCycle: true,
    });
  });

  it('returns null for unknown models', () => {
    expect(dfrobotCommsProfile(Model.DFROBOT_MODEL_UNSPECIFIED)).toBeNull();
    expect(dfrobotCommsProfile(null)).toBeNull();
  });
});

function idBytes(id: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, id, false); // false for Big Endian
  return new Uint8Array(buffer);
}

describe('commandIdMatches', () => {
  it('matches the 4-byte big-endian encoding of an id', () => {
    expect(commandIdMatches(idBytes(1), 1)).toBe(true);
    expect(commandIdMatches(idBytes(12345), 12345)).toBe(true);
  });

  it('returns false for wrong length', () => {
    expect(commandIdMatches(new Uint8Array([0, 0, 1]), 1)).toBe(false);
    expect(commandIdMatches(new Uint8Array([0, 0, 0, 0, 1]), 1)).toBe(false);
    expect(commandIdMatches(new Uint8Array([]), 0)).toBe(false);
  });

  it('returns false for null/undefined bytes or null id', () => {
    expect(commandIdMatches(null, 1)).toBe(false);
    expect(commandIdMatches(undefined, 1)).toBe(false);
    expect(commandIdMatches(idBytes(1), null)).toBe(false);
  });

  it('matches a high-bit id (e.g. 0x80000001) to its own encoding', () => {
    const highBitId = 0x80000001;
    expect(commandIdMatches(idBytes(highBitId), highBitId)).toBe(true);
  });
});

describe('planDfrobotConfigWrites', () => {
  const Model = dfrobot_rs485.DfrobotSensorModel;

  it('radiation: writes ID first, then baud addressed to the NEW id', () => {
    expect(planDfrobotConfigWrites(Model.DFROBOT_SEN0641_PAR, 2, 5, 9600)).toEqual([
      { modbusId: 2, register: 0x07d0, value: 5, label: 'ID → 5' },
      { modbusId: 5, register: 0x07d1, value: 2, label: 'baud → 9600' },
    ]);
  });

  it('radiation: baud-only change stays addressed to the current id', () => {
    expect(planDfrobotConfigWrites(Model.DFROBOT_SEN0640_IRRADIANCE, 1, null, 4800)).toEqual([
      { modbusId: 1, register: 0x07d1, value: 1, label: 'baud → 4800' },
    ]);
  });

  it('light: both writes go to the current id, baud first', () => {
    expect(planDfrobotConfigWrites(Model.DFROBOT_SEN0644_LIGHT, 4, 6, 4800)).toEqual([
      { modbusId: 4, register: 0x0065, value: 2, label: 'baud → 4800' },
      { modbusId: 4, register: 0x0064, value: 6, label: 'ID → 6' },
    ]);
  });

  it('returns an empty list when nothing changes', () => {
    expect(planDfrobotConfigWrites(Model.DFROBOT_SEN0641_PAR, 2, null, null)).toEqual([]);
  });

  it('returns null for unsupported baud or unknown model', () => {
    expect(planDfrobotConfigWrites(Model.DFROBOT_SEN0641_PAR, 2, null, 19200)).toBeNull();
    expect(planDfrobotConfigWrites(Model.DFROBOT_MODEL_UNSPECIFIED, 1, 2, null)).toBeNull();
  });
});
