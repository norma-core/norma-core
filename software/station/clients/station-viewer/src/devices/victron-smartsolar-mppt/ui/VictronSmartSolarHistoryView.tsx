import { useEffect, useState } from 'react';
import { victron_smartsolar_mppt } from '@/api/proto.js';
import webSocketManager from '@/api/websocket';
import type { HistoryExpandedProps } from '@/devices/history';
import {
  CHARGE_STATE_LABELS,
  DEVICE_MODE_LABELS,
  DEVICE_OFF_REASON_BITS,
  EMPTY_STATE,
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
  applyEnvelope,
  describeBitmask,
  describeEnum,
  readIntLE,
  readUintLE,
  scaled,
  victronDeviceLabel,
  type VictronState,
} from '@/devices/victron-smartsolar-mppt/values';

// The charger publishes ~8 envelopes/s (one TEXT block, the polled registers and
// the async frames). Replaying this many preceding entries reconstructs the same
// accumulated state the live widget holds; the window has to be wide enough to
// cover the async-only registers, which the charger volunteers every few seconds.
const REPLAY_ENTRIES = 64;

interface Item {
  label: string;
  value: string;
  tone?: string;
}

interface Group {
  title: string;
  items: Item[];
}

function idToBigInt(id: Uint8Array): bigint {
  let value = 0n;
  for (let i = id.length - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(id[i]);
  }
  return value;
}

function bigIntToId(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = 0; i < length; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function fmt(value: number | null, unit: string, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(decimals)} ${unit}`;
}

function fmtInt(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${value} ${unit}`;
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? victron_smartsolar_mppt.VictronSignalType.VICTRON_SIGNAL_TYPE_UNSPECIFIED;
  const enumName = victron_smartsolar_mppt.VictronSignalType[value];
  return enumName ? enumName.replace(/^VICTRON_/, '').replace(/_/g, ' ') : String(value);
}

function SummaryCell({ label, value, tone = 'text-accent-data' }: Item) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="text-[10px] uppercase text-text-label">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs ${tone}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function GroupPanel({ group }: { group: Group }) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">{group.title}</div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
        {group.items.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate text-text-secondary" title={item.label}>{item.label}</span>
            <span className={`max-w-[13rem] truncate font-mono ${item.tone ?? 'text-accent-data'}`} title={item.value}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VictronSmartSolarHistoryView({ entry }: HistoryExpandedProps<victron_smartsolar_mppt.IRxEnvelope>) {
  const { data, queueId, ptr: entryId } = entry;
  const [state, setState] = useState<VictronState>(() => applyEnvelope(EMPTY_STATE, data));

  useEffect(() => {
    let cancelled = false;

    if (!queueId || !entryId || entryId.length === 0) {
      setState(applyEnvelope(EMPTY_STATE, data));
      return;
    }

    const current = idToBigInt(entryId);
    const first = current > BigInt(REPLAY_ENTRIES) ? current - BigInt(REPLAY_ENTRIES) : 0n;

    const ids: Uint8Array[] = [];
    for (let id = first; id < current; id++) {
      ids.push(bigIntToId(id, entryId.length));
    }

    Promise.all(
      ids.map(async (id) => {
        try {
          const readEntry = await webSocketManager.normFs.readSingleEntry(queueId, id);
          return victron_smartsolar_mppt.RxEnvelope.decode(readEntry.data);
        } catch {
          return null;
        }
      }),
    ).then((envelopes) => {
      if (cancelled) return;
      // Oldest first, then the selected entry last so it always wins.
      const replayed = envelopes
        .filter((envelope): envelope is victron_smartsolar_mppt.RxEnvelope => envelope !== null)
        .reduce(applyEnvelope, EMPTY_STATE);
      setState(applyEnvelope(replayed, data));
    });

    return () => {
      cancelled = true;
    };
  }, [data, queueId, entryId]);

  const { textValues, hexRegs } = state;
  const device = data.device ?? null;

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

  const groups: Group[] = [
    {
      title: 'Battery',
      items: [
        { label: 'Voltage', value: fmt(textValues.batteryVoltageV, 'V'), tone: 'text-accent-success' },
        { label: 'Current', value: fmt(textValues.batteryCurrentA, 'A'), tone: 'text-accent-info' },
        { label: 'Charger voltage', value: fmt(chargerVoltageV, 'V'), tone: 'text-accent-success' },
      ],
    },
    {
      title: 'Solar',
      items: [
        { label: 'Panel voltage', value: fmt(textValues.panelVoltageV, 'V', 1), tone: 'text-accent-secondary' },
        { label: 'Panel power', value: fmtInt(textValues.panelPowerW, 'W'), tone: 'text-accent-warning' },
        { label: 'Solar activity', value: describeEnum(solarActivity, SOLAR_ACTIVITY_LABELS), tone: 'text-accent-warning' },
      ],
    },
    {
      title: 'Charger',
      items: [
        { label: 'Charge state', value: describeEnum(textValues.chargeState, CHARGE_STATE_LABELS), tone: 'text-accent-data' },
        { label: 'Tracker operation mode', value: describeEnum(textValues.mpptMode, MPPT_MODE_LABELS), tone: 'text-accent-data' },
        { label: 'Internal temperature', value: fmt(chargerTempC, 'C', 1), tone: 'text-accent-danger' },
        { label: 'Error', value: describeEnum(textValues.errorCode, ERROR_LABELS), tone: 'text-accent-danger' },
        { label: 'Off reason', value: describeBitmask(textValues.offReason, DEVICE_OFF_REASON_BITS, 'Running'), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Load',
      items: [
        { label: 'Output', value: textValues.loadOn === null ? 'N/A' : textValues.loadOn ? 'ON' : 'OFF', tone: 'text-accent-secondary' },
        { label: 'Current', value: fmt(textValues.loadCurrentA, 'A'), tone: 'text-accent-info' },
        { label: 'Output voltage', value: fmt(loadOutputVoltageV, 'V'), tone: 'text-accent-secondary' },
        { label: 'Off reason', value: describeBitmask(loadOffReason, LOAD_OFF_REASON_BITS, 'None'), tone: 'text-accent-info' },
      ],
    },
    {
      title: 'Yield',
      items: [
        { label: 'Total', value: fmt(textValues.yieldTotalKwh, 'kWh'), tone: 'text-accent-success' },
        { label: 'Today', value: fmt(textValues.yieldTodayKwh, 'kWh'), tone: 'text-accent-success' },
        { label: 'Max power today', value: fmtInt(textValues.maxPowerTodayW, 'W'), tone: 'text-accent-warning' },
        { label: 'Yesterday', value: fmt(textValues.yieldYesterdayKwh, 'kWh'), tone: 'text-accent-success' },
        { label: 'Max power yesterday', value: fmtInt(textValues.maxPowerYesterdayW, 'W'), tone: 'text-accent-warning' },
      ],
    },
    {
      title: 'Device',
      items: [
        { label: 'Mode', value: describeEnum(deviceMode, DEVICE_MODE_LABELS), tone: 'text-accent-data' },
        { label: 'State', value: describeEnum(deviceState, CHARGE_STATE_LABELS), tone: 'text-accent-data' },
        { label: 'Remote control', value: remoteControlLabel, tone: 'text-accent-info' },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCell
          label="Signal"
          value={signalLabel(data.signalType)}
          tone={data.error ? 'text-accent-critical' : 'text-accent-success'}
        />
        <SummaryCell label="Device" value={victronDeviceLabel(device)} tone="text-accent-info" />
        <SummaryCell label="Model" value={device?.modelName || 'N/A'} tone="text-accent-data" />
        <SummaryCell label="Firmware" value={device?.firmwareVersion || 'N/A'} tone="text-accent-secondary" />
        <SummaryCell label="Battery" value={fmt(textValues.batteryVoltageV, 'V')} tone="text-accent-success" />
        <SummaryCell label="Solar" value={fmtInt(textValues.panelPowerW, 'W')} tone="text-accent-warning" />
        <SummaryCell
          label="Charge state"
          value={describeEnum(textValues.chargeState, CHARGE_STATE_LABELS)}
          tone="text-accent-data"
        />
        <SummaryCell label="Charger temp" value={fmt(chargerTempC, 'C', 1)} tone="text-accent-danger" />
      </div>

      {data.error && (
        <div className="rounded bg-surface-primary px-2 py-1 text-xs text-accent-critical">{data.error}</div>
      )}

      {groups.map((group) => (
        <GroupPanel key={group.title} group={group} />
      ))}
    </div>
  );
}

export default VictronSmartSolarHistoryView;
