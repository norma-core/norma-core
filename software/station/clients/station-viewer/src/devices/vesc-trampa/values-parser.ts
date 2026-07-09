const COMMAND_GET_VALUES = 4;
const COMMAND_GET_VALUES_SEL = 50;
const FULL_VALUES_MASK = 0xffffffff;

export interface VescTrampaValues {
  commandId: number;
  mask: number;
  tempFetC?: number;
  tempMotorC?: number;
  avgMotorCurrentA?: number;
  avgInputCurrentA?: number;
  avgId?: number;
  avgIq?: number;
  dutyCycle?: number;
  rpm?: number;
  inputVoltageV?: number;
  ampHours?: number;
  ampHoursCharged?: number;
  wattHours?: number;
  wattHoursCharged?: number;
  tachometer?: number;
  tachometerAbs?: number;
  faultCode?: number;
  pidPosition?: number;
  controllerId?: number;
  mosfetTempsC?: [number, number, number];
  vd?: number;
  vq?: number;
  status?: number;
  timeoutActive?: boolean;
  killSwitchActive?: boolean;
  rawPayloadLen: number;
  extraBytes: Uint8Array;
}

export interface VescTrampaValuesParseResult {
  values: VescTrampaValues | null;
  error: string | null;
}

class PayloadReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  extra(): Uint8Array {
    if (this.offset >= this.data.length) {
      return new Uint8Array();
    }
    return this.data.slice(this.offset);
  }

  private need(field: string, bytes: number): void {
    const remaining = this.data.length - this.offset;
    if (remaining < bytes) {
      throw new Error(`${field}: need ${bytes} bytes, have ${remaining}`);
    }
  }

  u8(field: string): number {
    this.need(field, 1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u32(field: string): number {
    this.need(field, 4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  i16(field: string): number {
    this.need(field, 2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  i32(field: string): number {
    this.need(field, 4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  float16(field: string, scale: number): number {
    return this.i16(field) / scale;
  }

  float32(field: string, scale: number): number {
    return this.i32(field) / scale;
  }
}

function hasValue(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

function parseValuesPayload(payload: Uint8Array): VescTrampaValues {
  if (payload.length === 0) {
    throw new Error('empty VESC values payload');
  }

  const commandId = payload[0];
  if (commandId !== COMMAND_GET_VALUES && commandId !== COMMAND_GET_VALUES_SEL) {
    throw new Error(`unexpected VESC values command id ${commandId}`);
  }

  const reader = new PayloadReader(payload.slice(1));
  const values: VescTrampaValues = {
    commandId,
    mask: FULL_VALUES_MASK,
    rawPayloadLen: payload.length,
    extraBytes: new Uint8Array(),
  };

  if (commandId === COMMAND_GET_VALUES_SEL) {
    values.mask = reader.u32('values_mask');
  }

  if (hasValue(values.mask, 0)) values.tempFetC = reader.float16('temp_fet_c', 10);
  if (hasValue(values.mask, 1)) values.tempMotorC = reader.float16('temp_motor_c', 10);
  if (hasValue(values.mask, 2)) values.avgMotorCurrentA = reader.float32('avg_motor_current_a', 100);
  if (hasValue(values.mask, 3)) values.avgInputCurrentA = reader.float32('avg_input_current_a', 100);
  if (hasValue(values.mask, 4)) values.avgId = reader.float32('avg_id', 100);
  if (hasValue(values.mask, 5)) values.avgIq = reader.float32('avg_iq', 100);
  if (hasValue(values.mask, 6)) values.dutyCycle = reader.float16('duty_cycle', 1000);
  if (hasValue(values.mask, 7)) values.rpm = reader.float32('rpm', 1);
  if (hasValue(values.mask, 8)) values.inputVoltageV = reader.float16('input_voltage_v', 10);
  if (hasValue(values.mask, 9)) values.ampHours = reader.float32('amp_hours', 10000);
  if (hasValue(values.mask, 10)) values.ampHoursCharged = reader.float32('amp_hours_charged', 10000);
  if (hasValue(values.mask, 11)) values.wattHours = reader.float32('watt_hours', 10000);
  if (hasValue(values.mask, 12)) values.wattHoursCharged = reader.float32('watt_hours_charged', 10000);
  if (hasValue(values.mask, 13)) values.tachometer = reader.i32('tachometer');
  if (hasValue(values.mask, 14)) values.tachometerAbs = reader.i32('tachometer_abs');
  if (hasValue(values.mask, 15)) values.faultCode = reader.u8('fault_code');
  if (hasValue(values.mask, 16)) values.pidPosition = reader.float32('pid_position', 1000000);
  if (hasValue(values.mask, 17)) values.controllerId = reader.u8('controller_id');
  if (hasValue(values.mask, 18)) {
    values.mosfetTempsC = [
      reader.float16('mosfet_temp_1_c', 10),
      reader.float16('mosfet_temp_2_c', 10),
      reader.float16('mosfet_temp_3_c', 10),
    ];
  }
  if (hasValue(values.mask, 19)) values.vd = reader.float32('vd', 1000);
  if (hasValue(values.mask, 20)) values.vq = reader.float32('vq', 1000);
  if (hasValue(values.mask, 21)) {
    values.status = reader.u8('status');
    values.timeoutActive = (values.status & 0x01) !== 0;
    values.killSwitchActive = (values.status & 0x02) !== 0;
  }

  values.extraBytes = reader.extra();
  return values;
}

export function parseVescTrampaValuesPayload(payload?: Uint8Array | null): VescTrampaValuesParseResult {
  if (!payload || payload.length === 0) {
    return { values: null, error: null };
  }

  try {
    return { values: parseValuesPayload(payload), error: null };
  } catch (error) {
    return {
      values: null,
      error: error instanceof Error ? error.message : 'failed to parse VESC values payload',
    };
  }
}

export function formatVescNumber(value: number | undefined, digits = 1, suffix = ''): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '--';
  }
  return `${value.toFixed(digits)}${suffix}`;
}

export function formatVescInteger(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '--';
  }
  return Math.round(value).toLocaleString();
}
