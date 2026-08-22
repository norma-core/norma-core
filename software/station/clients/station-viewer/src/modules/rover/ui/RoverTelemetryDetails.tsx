import type { ReactNode } from 'react';
import Long from 'long';
import { pwm_output, vesc_trampa, victron_smartsolar_mppt } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import {
  CHARGE_STATE_LABELS,
  DEVICE_MODE_LABELS,
  DEVICE_OFF_REASON_BITS,
  ERROR_LABELS,
  LOAD_OFF_REASON_BITS,
  MPPT_MODE_LABELS,
  REG_CHARGER_INTERNAL_TEMP,
  REG_CHARGER_VOLTAGE,
  REG_DEVICE_MODE,
  REG_DEVICE_STATE,
  REG_LOAD_OFF_REASON,
  REG_LOAD_OUTPUT_VOLTAGE,
  REG_REMOTE_CONTROL_USED,
  REG_SOLAR_ACTIVITY,
  REMOTE_ON_OFF_MASK,
  SOLAR_ACTIVITY_LABELS,
  describeBitmask,
  describeEnum,
  readIntLE,
  readUintLE,
  scaled,
  victronDeviceLabel,
  type VictronState,
} from '@/modules/victron-smartsolar-mppt/values';
import type { VescTrampaValues } from '@/modules/vesc-trampa/values-parser';
import { formatVescTrampaUuid, longToNumber } from '@/modules/vesc-trampa/utils';

interface RoverTelemetryDetailsProps {
  boardState: vesc_trampa.InferenceState.IBoardState | null;
  values: VescTrampaValues | null;
  valuesError: string | null;
  pwmOutputRx?: pwm_output.IRxEnvelope;
  pwmOutputTx?: pwm_output.ITxEnvelope;
  powerState: VictronState;
  powerEnvelope?: victron_smartsolar_mppt.IRxEnvelope;
}

function numberValue(value: number | null | undefined, digits: number, suffix = ''): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '--'
    : `${value.toFixed(digits)}${suffix}`;
}

function integerValue(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '--'
    : Math.round(value).toLocaleString();
}

function ageValue(stampNs: Long | number | null | undefined): string {
  if (!stampNs) return '--';
  const localStamp = serverToLocal(Long.fromValue(stampNs));
  const ageMs = Math.max(0, Date.now() - localStamp.toNumber() / 1e6);
  return ageMs < 1000 ? `${ageMs.toFixed(0)}ms` : `${(ageMs / 1000).toFixed(1)}s`;
}

function formatPwmLevel(level?: pwm_output.WaveLevel | null): string {
  if (level === pwm_output.WaveLevel.WAVE_LEVEL_HIGH) return 'H';
  if (level === pwm_output.WaveLevel.WAVE_LEVEL_LOW) return 'L';
  return '?';
}

function formatPwmWave(wave?: pwm_output.IWaveCommand | null): string {
  if (!wave) return '--';
  const segments = (wave.segments ?? [])
    .map((segment) => `${formatPwmLevel(segment.level)}${segment.durationUs ?? 0}µs`)
    .join(' ');
  return `ch${wave.channel ?? 0} ×${wave.repeat ?? 0}${segments ? ` · ${segments}` : ''}`;
}

function formatPwmCommand(command?: pwm_output.ICommand | null): string {
  if (!command) return '--';
  if (command.wave) return formatPwmWave(command.wave);
  if (command.disable) return `disable ch${command.disable.channel ?? 0}`;
  return '--';
}

function pwmSignalLabel(signal?: pwm_output.PwmOutputSignalType | null): string {
  switch (signal) {
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_CONFIGURED: return 'Configured';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND: return 'Command';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_SUCCESS: return 'Success';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_REJECTED: return 'Rejected';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_FAILED: return 'Failed';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_ERROR: return 'Error';
    default: return '--';
  }
}

function TelemetrySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-default py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-accent-data">{title}</h3>
      <div className="grid grid-cols-2 gap-x-5 md:grid-cols-3">{children}</div>
    </section>
  );
}

function TelemetryValue({
  label,
  children,
  tone = 'normal',
  wide = false,
}: {
  label: string;
  children: ReactNode;
  tone?: 'normal' | 'good' | 'warn' | 'danger';
  wide?: boolean;
}) {
  const toneClass = {
    normal: 'text-text-primary',
    good: 'text-accent-success',
    warn: 'text-accent-warning',
    danger: 'text-accent-critical',
  }[tone];
  return (
    <div className={`min-w-0 border-b border-border-subtle py-2 ${wide ? 'col-span-2 md:col-span-3' : ''}`}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs font-semibold tabular-nums ${toneClass}`} title={typeof children === 'string' ? children : undefined}>
        {children}
      </div>
    </div>
  );
}

export default function RoverTelemetryDetails({
  boardState,
  values,
  valuesError,
  pwmOutputRx,
  pwmOutputTx,
  powerState,
  powerEnvelope,
}: RoverTelemetryDetailsProps) {
  const board = boardState?.board;
  const boardUuid = board?.uuid ?? new Uint8Array();
  const motorMode = boardState?.motorMode === vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_HOLD
    ? 'Hold'
    : 'Active';
  const statusFlags = values?.status === undefined
    ? '--'
    : `0x${values.status.toString(16).padStart(2, '0')} · timeout ${values.timeoutActive ? 'ON' : 'off'} · kill ${values.killSwitchActive ? 'ON' : 'off'}`;
  const mosfetTemps = values?.mosfetTempsC?.map((temperature) => `${temperature.toFixed(1)}°C`).join(' / ') ?? '--';
  const firmware = board ? `${board.firmwareMajor ?? 0}.${board.firmwareMinor ?? 0}` : '--';

  const text = powerState.textValues;
  const hex = powerState.hexRegs;
  const chargerTempC = scaled(readIntLE(hex.get(REG_CHARGER_INTERNAL_TEMP), 2), 0.01);
  const chargerVoltageV = scaled(readUintLE(hex.get(REG_CHARGER_VOLTAGE)), 0.01);
  const loadOutputVoltageV = scaled(readUintLE(hex.get(REG_LOAD_OUTPUT_VOLTAGE)), 0.01);
  const loadOffReason = readUintLE(hex.get(REG_LOAD_OFF_REASON));
  const solarActivity = readUintLE(hex.get(REG_SOLAR_ACTIVITY));
  const deviceMode = readUintLE(hex.get(REG_DEVICE_MODE));
  const deviceState = readUintLE(hex.get(REG_DEVICE_STATE));
  const remoteControl = readUintLE(hex.get(REG_REMOTE_CONTROL_USED));
  const remoteControlLabel = remoteControl === null
    ? '--'
    : (remoteControl & REMOTE_ON_OFF_MASK) !== 0 ? 'On' : 'Off';
  const chargeError = powerEnvelope?.error
    || describeEnum(text.errorCode, ERROR_LABELS);

  return (
    <div>
      <TelemetrySection title="VESC · identity and link">
        <TelemetryValue label="UUID" wide>{boardUuid.length ? formatVescTrampaUuid(boardUuid) : '--'}</TelemetryValue>
        <TelemetryValue label="Port">{board?.portName || '--'}</TelemetryValue>
        <TelemetryValue label="Serial">{board?.serialNumber || '--'}</TelemetryValue>
        <TelemetryValue label="Hardware">{board?.hardwareName || '--'}</TelemetryValue>
        <TelemetryValue label="Firmware">{firmware}</TelemetryValue>
        <TelemetryValue label="Motor mode">{motorMode}</TelemetryValue>
        <TelemetryValue label="Values age">{ageValue(boardState?.valuesMonotonicStampNs)}</TelemetryValue>
        <TelemetryValue label="State age">{ageValue(boardState?.monotonicStampNs)}</TelemetryValue>
        <TelemetryValue label="App start">{longToNumber(boardState?.valuesAppStartId)?.toLocaleString() ?? '--'}</TelemetryValue>
        {valuesError && <TelemetryValue label="Payload error" tone="danger" wide>{valuesError}</TelemetryValue>}
      </TelemetrySection>

      <TelemetrySection title="VESC · electrical and temperature">
        <TelemetryValue label="RPM">{integerValue(values?.rpm)}</TelemetryValue>
        <TelemetryValue label="Duty">{values?.dutyCycle === undefined ? '--' : `${(values.dutyCycle * 100).toFixed(1)}%`}</TelemetryValue>
        <TelemetryValue label="Input voltage">{numberValue(values?.inputVoltageV, 1, 'V')}</TelemetryValue>
        <TelemetryValue label="Motor current">{numberValue(values?.avgMotorCurrentA, 2, 'A')}</TelemetryValue>
        <TelemetryValue label="Input current">{numberValue(values?.avgInputCurrentA, 2, 'A')}</TelemetryValue>
        <TelemetryValue label="FET temperature" tone={(values?.tempFetC ?? 0) > 65 ? 'danger' : 'normal'}>{numberValue(values?.tempFetC, 1, '°C')}</TelemetryValue>
        <TelemetryValue label="Motor temperature" tone={(values?.tempMotorC ?? 0) > 65 ? 'danger' : 'normal'}>{numberValue(values?.tempMotorC, 1, '°C')}</TelemetryValue>
        <TelemetryValue label="MOSFET temperatures" wide>{mosfetTemps}</TelemetryValue>
        <TelemetryValue label="Fault" tone={values?.faultCode ? 'danger' : 'good'}>{values?.faultCode === undefined ? '--' : String(values.faultCode)}</TelemetryValue>
        <TelemetryValue label="Safety status" tone={values?.timeoutActive || values?.killSwitchActive ? 'danger' : 'good'} wide>{statusFlags}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="VESC · counters and FOC">
        <TelemetryValue label="Tachometer">{integerValue(values?.tachometer)}</TelemetryValue>
        <TelemetryValue label="Tachometer abs">{integerValue(values?.tachometerAbs)}</TelemetryValue>
        <TelemetryValue label="Controller ID">{integerValue(values?.controllerId)}</TelemetryValue>
        <TelemetryValue label="Amp hours">{numberValue(values?.ampHours, 4, 'Ah')}</TelemetryValue>
        <TelemetryValue label="Amp hours charged">{numberValue(values?.ampHoursCharged, 4, 'Ah')}</TelemetryValue>
        <TelemetryValue label="Watt hours">{numberValue(values?.wattHours, 4, 'Wh')}</TelemetryValue>
        <TelemetryValue label="Watt hours charged">{numberValue(values?.wattHoursCharged, 4, 'Wh')}</TelemetryValue>
        <TelemetryValue label="Id / Iq">{numberValue(values?.avgId, 2)} / {numberValue(values?.avgIq, 2)}</TelemetryValue>
        <TelemetryValue label="Vd / Vq">{numberValue(values?.vd, 3)} / {numberValue(values?.vq, 3)}</TelemetryValue>
        <TelemetryValue label="PID position">{numberValue(values?.pidPosition, 6)}</TelemetryValue>
        <TelemetryValue label="Command / mask">{values ? `${values.commandId} / 0x${values.mask.toString(16)}` : '--'}</TelemetryValue>
        <TelemetryValue label="Payload / extra">{values ? `${values.rawPayloadLen} / ${values.extraBytes.length} bytes` : '--'}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="PWM steering">
        <TelemetryValue label="Signal">{pwmSignalLabel(pwmOutputRx?.signalType)}</TelemetryValue>
        <TelemetryValue label="Output">{pwmOutputRx?.device?.id || pwmOutputRx?.state?.id || pwmOutputTx?.targetOutputId || '--'}</TelemetryValue>
        <TelemetryValue label="Enabled" tone={pwmOutputRx?.state?.enabled ? 'good' : 'warn'}>{pwmOutputRx?.state?.enabled ? 'Yes' : 'No'}</TelemetryValue>
        <TelemetryValue label="RX age">{ageValue(pwmOutputRx?.monotonicStampNs)}</TelemetryValue>
        <TelemetryValue label="State wave" wide>{formatPwmWave(pwmOutputRx?.state?.wave)}</TelemetryValue>
        <TelemetryValue label="Latest TX" wide>{formatPwmCommand(pwmOutputTx?.command)}</TelemetryValue>
        <TelemetryValue label="Result command" wide>{formatPwmCommand(pwmOutputRx?.command?.command)}</TelemetryValue>
        <TelemetryValue label="Error" tone={pwmOutputRx?.error ? 'danger' : 'good'} wide>{pwmOutputRx?.error || 'No error'}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="Victron · battery and solar">
        <TelemetryValue label="Battery voltage">{numberValue(text.batteryVoltageV, 2, 'V')}</TelemetryValue>
        <TelemetryValue label="Battery current">{numberValue(text.batteryCurrentA, 2, 'A')}</TelemetryValue>
        <TelemetryValue label="Charger voltage">{numberValue(chargerVoltageV, 2, 'V')}</TelemetryValue>
        <TelemetryValue label="Panel voltage">{numberValue(text.panelVoltageV, 1, 'V')}</TelemetryValue>
        <TelemetryValue label="Panel power">{numberValue(text.panelPowerW, 0, 'W')}</TelemetryValue>
        <TelemetryValue label="Solar activity">{describeEnum(solarActivity, SOLAR_ACTIVITY_LABELS)}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="Victron · charger">
        <TelemetryValue label="Charge state">{describeEnum(text.chargeState, CHARGE_STATE_LABELS)}</TelemetryValue>
        <TelemetryValue label="MPPT mode">{describeEnum(text.mpptMode, MPPT_MODE_LABELS)}</TelemetryValue>
        <TelemetryValue label="Temperature">{numberValue(chargerTempC, 1, '°C')}</TelemetryValue>
        <TelemetryValue label="Error" tone={text.errorCode || powerEnvelope?.error ? 'danger' : 'good'}>{chargeError}</TelemetryValue>
        <TelemetryValue label="Off reason" wide>{describeBitmask(text.offReason, DEVICE_OFF_REASON_BITS, 'Running')}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="Victron · load">
        <TelemetryValue label="Output" tone={text.loadOn ? 'good' : 'warn'}>{text.loadOn === null ? '--' : text.loadOn ? 'On' : 'Off'}</TelemetryValue>
        <TelemetryValue label="Current">{numberValue(text.loadCurrentA, 2, 'A')}</TelemetryValue>
        <TelemetryValue label="Voltage">{numberValue(loadOutputVoltageV, 2, 'V')}</TelemetryValue>
        <TelemetryValue label="Off reason" wide>{describeBitmask(loadOffReason, LOAD_OFF_REASON_BITS, 'None')}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="Victron · yield">
        <TelemetryValue label="Total">{numberValue(text.yieldTotalKwh, 2, 'kWh')}</TelemetryValue>
        <TelemetryValue label="Today">{numberValue(text.yieldTodayKwh, 2, 'kWh')}</TelemetryValue>
        <TelemetryValue label="Max today">{numberValue(text.maxPowerTodayW, 0, 'W')}</TelemetryValue>
        <TelemetryValue label="Yesterday">{numberValue(text.yieldYesterdayKwh, 2, 'kWh')}</TelemetryValue>
        <TelemetryValue label="Max yesterday">{numberValue(text.maxPowerYesterdayW, 0, 'W')}</TelemetryValue>
      </TelemetrySection>

      <TelemetrySection title="Victron · device">
        <TelemetryValue label="Device" wide>{victronDeviceLabel(powerEnvelope?.device)}</TelemetryValue>
        <TelemetryValue label="Model">{powerEnvelope?.device?.modelName || '--'}</TelemetryValue>
        <TelemetryValue label="Firmware">{powerEnvelope?.device?.firmwareVersion || '--'}</TelemetryValue>
        <TelemetryValue label="Mode">{describeEnum(deviceMode, DEVICE_MODE_LABELS)}</TelemetryValue>
        <TelemetryValue label="State">{describeEnum(deviceState, CHARGE_STATE_LABELS)}</TelemetryValue>
        <TelemetryValue label="Remote control">{remoteControlLabel}</TelemetryValue>
      </TelemetrySection>
    </div>
  );
}
