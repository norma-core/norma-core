import type { ReactNode } from 'react';
import { victron_smartsolar_mppt } from '@/api/proto.js';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';
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
  type VictronTextValues,
} from '../values';

function fmt(value: number | null, unit: string, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(decimals)} ${unit}`;
}

function fmtInt(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${value} ${unit}`;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-text-label">{title}</div>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export interface VictronSmartSolarWidgetProps {
  device: victron_smartsolar_mppt.IVictronDevice | null | undefined;
  textValues: VictronTextValues;
  hexRegs: Map<number, Uint8Array>;
  error?: string | null;
}

function VictronSmartSolarWidget({ device, textValues, hexRegs, error }: VictronSmartSolarWidgetProps) {
  const chargerTempC = scaled(readIntLE(hexRegs.get(REG_CHARGER_INTERNAL_TEMP), 2), 0.01);
  const chargerVoltageV = scaled(readUintLE(hexRegs.get(REG_CHARGER_VOLTAGE)), 0.01);
  const loadOutputVoltageV = scaled(readUintLE(hexRegs.get(REG_LOAD_OUTPUT_VOLTAGE)), 0.01);
  const loadOffReason = readUintLE(hexRegs.get(REG_LOAD_OFF_REASON));
  const solarActivity = readUintLE(hexRegs.get(REG_SOLAR_ACTIVITY));
  const deviceMode = readUintLE(hexRegs.get(REG_DEVICE_MODE));
  const deviceState = readUintLE(hexRegs.get(REG_DEVICE_STATE));
  const remoteControl = readUintLE(hexRegs.get(REG_REMOTE_CONTROL_USED));
  const remoteControlLabel =
    remoteControl === null ? 'N/A' : (remoteControl & REMOTE_ON_OFF_MASK) !== 0 ? 'On' : 'Off';

  const chargerError =
    textValues.errorCode && textValues.errorCode !== 0
      ? describeEnum(textValues.errorCode, ERROR_LABELS)
      : null;
  const widgetError = error || chargerError || undefined;

  const subtitle = device?.firmwareVersion
    ? `${device.modelName || 'SmartSolar MPPT'} · fw ${device.firmwareVersion}`
    : device?.modelName || 'Victron SmartSolar MPPT';

  return (
    <DeviceWidgetShell title={victronDeviceLabel(device)} subtitle={subtitle} error={widgetError}>
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">Battery</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-success">
            {textValues.batteryVoltageV === null ? 'N/A' : textValues.batteryVoltageV.toFixed(2)}
            <span className="ml-1 text-sm text-text-muted">V</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">Solar</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-warning">
            {textValues.panelPowerW === null ? 'N/A' : textValues.panelPowerW.toLocaleString()}
            <span className="ml-1 text-xs text-text-muted">W</span>
          </div>
        </div>
      </div>

      <Group title="Battery">
        <DeviceMetricPill label="Current" value={fmt(textValues.batteryCurrentA, 'A', 2)} tone="text-accent-info" />
        <DeviceMetricPill label="Charger V" value={fmt(chargerVoltageV, 'V', 2)} tone="text-accent-success" />
      </Group>

      <Group title="Solar">
        <DeviceMetricPill label="Panel V" value={fmt(textValues.panelVoltageV, 'V', 1)} tone="text-accent-secondary" />
        <DeviceMetricPill label="Solar activity" value={describeEnum(solarActivity, SOLAR_ACTIVITY_LABELS)} tone="text-accent-warning" />
      </Group>

      <Group title="Charger">
        <DeviceMetricPill label="State" value={describeEnum(textValues.chargeState, CHARGE_STATE_LABELS)} tone="text-accent-data" />
        <DeviceMetricPill label="Tracker operation mode" value={describeEnum(textValues.mpptMode, MPPT_MODE_LABELS)} tone="text-accent-data" />
        <DeviceMetricPill label="Temp" value={fmt(chargerTempC, 'C', 1)} tone="text-accent-danger" />
        <DeviceMetricPill label="Error" value={describeEnum(textValues.errorCode, ERROR_LABELS)} tone="text-accent-danger" />
        <DeviceMetricPill label="Off reason" value={describeBitmask(textValues.offReason, DEVICE_OFF_REASON_BITS, 'Running')} tone="text-accent-info" />
      </Group>

      <Group title="Load">
        <DeviceMetricPill label="Output" value={textValues.loadOn === null ? 'N/A' : textValues.loadOn ? 'ON' : 'OFF'} tone="text-accent-secondary" />
        <DeviceMetricPill label="Current" value={fmt(textValues.loadCurrentA, 'A', 2)} tone="text-accent-info" />
        <DeviceMetricPill label="Voltage" value={fmt(loadOutputVoltageV, 'V', 2)} tone="text-accent-secondary" />
        <DeviceMetricPill label="Off reason" value={describeBitmask(loadOffReason, LOAD_OFF_REASON_BITS, 'None')} tone="text-accent-info" />
      </Group>

      <Group title="Yield">
        <DeviceMetricPill label="Total" value={fmt(textValues.yieldTotalKwh, 'kWh', 2)} tone="text-accent-success" />
        <DeviceMetricPill label="Today" value={fmt(textValues.yieldTodayKwh, 'kWh', 2)} tone="text-accent-success" />
        <DeviceMetricPill label="Max today" value={fmtInt(textValues.maxPowerTodayW, 'W')} tone="text-accent-warning" />
        <DeviceMetricPill label="Yesterday" value={fmt(textValues.yieldYesterdayKwh, 'kWh', 2)} tone="text-accent-success" />
        <DeviceMetricPill label="Max yest." value={fmtInt(textValues.maxPowerYesterdayW, 'W')} tone="text-accent-warning" />
      </Group>

      <Group title="Device">
        <DeviceMetricPill label="Mode" value={describeEnum(deviceMode, DEVICE_MODE_LABELS)} tone="text-accent-data" />
        <DeviceMetricPill label="State" value={describeEnum(deviceState, CHARGE_STATE_LABELS)} tone="text-accent-data" />
        <DeviceMetricPill label="Remote control" value={remoteControlLabel} tone="text-accent-info" />
      </Group>
    </DeviceWidgetShell>
  );
}

export default VictronSmartSolarWidget;
