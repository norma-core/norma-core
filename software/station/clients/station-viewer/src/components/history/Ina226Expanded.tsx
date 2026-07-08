import { ina226 } from '@/api/proto.js';
import {
  INA226_BUS_REGISTER,
  INA226_BUS_VOLTAGE_LSB_V,
  INA226_CONFIG_REGISTER,
  INA226_DIE_ID_REGISTER,
  INA226_DUMP_REGISTERS,
  INA226_MANUFACTURER_ID_REGISTER,
  INA226_SHUNT_REGISTER,
  INA226_SHUNT_VOLTAGE_LSB_MV,
  formatIna226Current,
  readIna226CurrentAmps,
  readIna226Word,
  toSigned16,
} from '@/utils/ina226';

interface Ina226ExpandedProps {
  data: ina226.IRxEnvelope;
}

interface SummaryValue {
  label: string;
  value: string;
  tone?: string;
}

interface RegisterDefinition {
  label: string;
  format: (word: number | null) => string;
  tone?: string;
}

const PRIMARY_REGISTERS: number[] = [
  INA226_SHUNT_REGISTER,
  INA226_BUS_REGISTER,
  INA226_CONFIG_REGISTER,
  0x03,
  0x04,
  0x05,
  0x06,
  0x07,
  INA226_MANUFACTURER_ID_REGISTER,
  INA226_DIE_ID_REGISTER,
];

function bytesFrom(data: Uint8Array | null | undefined): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array();
}

function wordAt(bytes: Uint8Array, register: number): number | null {
  return readIna226Word(bytes, register);
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function hexWord(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function finiteNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 100000 || abs < 0.001)) {
    return value.toExponential(3);
  }
  return value.toFixed(decimals);
}

function measured(value: number | null, unit?: string, decimals = 3): string {
  if (value === null) {
    return 'N/A';
  }
  return unit ? `${finiteNumber(value, decimals)} ${unit}` : finiteNumber(value, decimals);
}

function rawWithMeasured(word: number | null, value: number | null, unit: string, decimals = 3): string {
  if (word === null || value === null) {
    return 'N/A';
  }
  return `${measured(value, unit, decimals)} (${hexWord(word)})`;
}

function asciiWord(word: number | null): string {
  if (word === null) {
    return 'N/A';
  }
  const high = (word >> 8) & 0xff;
  const low = word & 0xff;
  const chars = [high, low].map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'));
  return `${hexWord(word)} (${chars.join('')})`;
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? ina226.Ina226SignalType.INA226_SIGNAL_TYPE_UNSPECIFIED;
  const enumName = ina226.Ina226SignalType[value];
  if (!enumName) {
    return String(value);
  }
  return enumName.replace(/^INA226_/, '').replace(/_/g, ' ');
}

const REGISTER_DEFINITIONS = new Map<number, RegisterDefinition>([
  [0x00, { label: 'Configuration', format: (word) => hexWord(word), tone: 'text-accent-data' }],
  [
    0x01,
    {
      label: 'Shunt Voltage',
      format: (word) => rawWithMeasured(word, word === null ? null : toSigned16(word) * INA226_SHUNT_VOLTAGE_LSB_MV, 'mV', 4),
      tone: 'text-accent-warning',
    },
  ],
  [
    0x02,
    {
      label: 'Bus Voltage',
      format: (word) => rawWithMeasured(word, word === null ? null : word * INA226_BUS_VOLTAGE_LSB_V, 'V', 4),
      tone: 'text-accent-info',
    },
  ],
  [0x03, { label: 'Power', format: (word) => word === null ? 'N/A' : `${word.toLocaleString()} (${hexWord(word)})`, tone: 'text-accent-secondary' }],
  [0x04, { label: 'Current', format: (word) => word === null ? 'N/A' : `${toSigned16(word).toLocaleString()} (${hexWord(word)})`, tone: 'text-accent-success' }],
  [0x05, { label: 'Calibration', format: (word) => hexWord(word), tone: 'text-accent-data' }],
  [0x06, { label: 'Mask/Enable', format: (word) => hexWord(word), tone: 'text-accent-secondary' }],
  [0x07, { label: 'Alert Limit', format: (word) => hexWord(word), tone: 'text-accent-warning' }],
  [0x0e, { label: 'Manufacturer ID', format: asciiWord, tone: 'text-accent-info' }],
  [
    0x0f,
    {
      label: 'Die ID',
      format: (word) => word === null ? 'N/A' : `${hexWord(word)} (die 0x${(word >> 4).toString(16).toUpperCase()}, rev ${word & 0x0f})`,
      tone: 'text-accent-data',
    },
  ],
]);

function definitionFor(register: number): RegisterDefinition {
  return REGISTER_DEFINITIONS.get(register) ?? {
    label: 'Reserved',
    format: (word) => hexWord(word),
    tone: 'text-text-muted',
  };
}

function SummaryCell({ label, value, tone = 'text-accent-data' }: SummaryValue) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="text-[10px] uppercase text-text-label">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs ${tone}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function RegisterRow({ register, word }: { register: number; word: number | null }) {
  const definition = definitionFor(register);
  const value = definition.format(word);
  return (
    <div className="grid grid-cols-[4rem_1fr_9rem] gap-2 border-b border-border-subtle py-1 text-xs last:border-b-0">
      <span className="font-mono text-text-muted">{hexByte(register)}</span>
      <span className="truncate text-text-secondary" title={definition.label}>{definition.label}</span>
      <span className={`truncate text-right font-mono ${definition.tone ?? 'text-accent-data'}`} title={value}>{value}</span>
    </div>
  );
}

function DumpCell({ register, word }: { register: number; word: number | null }) {
  const definition = definitionFor(register);
  const value = word === null ? 'XXXX' : hexWord(word).slice(2);
  return (
    <div className="min-w-0 rounded bg-surface-secondary/60 px-1.5 py-1" title={`${hexByte(register)} ${definition.label}: ${word === null ? 'N/A' : definition.format(word)}`}>
      <div className="font-mono text-[10px] text-text-muted">{register.toString(16).toUpperCase().padStart(2, '0')}</div>
      <div className={`truncate font-mono text-xs ${word === null ? 'text-accent-critical' : definition.tone ?? 'text-accent-data'}`}>
        {value}
      </div>
      <div className="truncate text-[10px] text-text-label">{definition.label}</div>
    </div>
  );
}

export default function Ina226Expanded({ data }: Ina226ExpandedProps) {
  const bytes = bytesFrom(data.data);
  const device = data.device ?? null;
  const info = device?.info ?? null;
  const shuntWord = wordAt(bytes, INA226_SHUNT_REGISTER);
  const busWord = wordAt(bytes, INA226_BUS_REGISTER);
  const manufacturerWord = wordAt(bytes, INA226_MANUFACTURER_ID_REGISTER);
  const dieWord = wordAt(bytes, INA226_DIE_ID_REGISTER);
  const shuntResistanceOhms = info?.shuntResistanceOhms ?? null;
  const currentAmps = readIna226CurrentAmps(bytes, shuntResistanceOhms);
  const currentText = formatIna226Current(currentAmps).text;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCell label="Signal" value={signalLabel(data.signalType)} tone={data.error ? 'text-accent-critical' : 'text-accent-success'} />
        <SummaryCell label="Device" value={device?.id ?? 'N/A'} tone="text-accent-info" />
        <SummaryCell
          label="I2C"
          value={device ? `bus ${device.i2cBus ?? 'N/A'} / ${hexByte(device.i2cAddress)}` : 'N/A'}
          tone="text-accent-warning"
        />
        <SummaryCell
          label="Current"
          value={currentText}
          tone="text-accent-success"
        />
        <SummaryCell
          label="Shunt Voltage"
          value={rawWithMeasured(shuntWord, shuntWord === null ? null : toSigned16(shuntWord) * INA226_SHUNT_VOLTAGE_LSB_MV, 'mV', 4)}
          tone="text-accent-warning"
        />
        <SummaryCell
          label="Shunt R"
          value={measured(shuntResistanceOhms && shuntResistanceOhms > 0 ? shuntResistanceOhms : null, 'ohm', 4)}
          tone="text-accent-secondary"
        />
        <SummaryCell
          label="Bus Voltage"
          value={rawWithMeasured(busWord, busWord === null ? null : busWord * INA226_BUS_VOLTAGE_LSB_V, 'V', 4)}
          tone="text-accent-info"
        />
        <SummaryCell label="Manufacturer" value={asciiWord(info?.manufacturerId ?? manufacturerWord)} tone="text-accent-info" />
        <SummaryCell label="Die" value={hexWord(info?.dieId ?? (dieWord === null ? null : dieWord >> 4))} tone="text-accent-data" />
        <SummaryCell label="Revision" value={info?.revisionId?.toString() ?? (dieWord === null ? 'N/A' : String(dieWord & 0x0f))} tone="text-accent-secondary" />
      </div>

      {data.error && (
        <div className="rounded bg-surface-primary p-2 text-xs text-accent-critical">
          {data.error}
        </div>
      )}

      <div className="rounded bg-surface-primary p-2">
        <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">Mapped Registers</div>
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          {PRIMARY_REGISTERS.map((register) => (
            <RegisterRow key={register} register={register} word={wordAt(bytes, register)} />
          ))}
        </div>
      </div>

      <div className="rounded bg-surface-primary p-2">
        <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">Register Dump</div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-8 xl:grid-cols-16">
          {INA226_DUMP_REGISTERS.map((register) => (
            <DumpCell key={register} register={register} word={wordAt(bytes, register)} />
          ))}
        </div>
      </div>
    </div>
  );
}
