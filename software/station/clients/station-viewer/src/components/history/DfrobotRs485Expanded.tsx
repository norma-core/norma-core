import { dfrobot_rs485 } from '@/api/proto.js';
import {
  DFROBOT_SPECS,
  decodeDfrobotRegisters,
  dfrobotModelLabel,
  dfrobotPrimaryText,
  formatDfrobotValue,
  type DecodedDfrobotRegister,
  type DfrobotRegisterKind,
} from '@/devices/dfrobot-rs485/values';

interface DfrobotRs485ExpandedProps {
  data: dfrobot_rs485.IRxEnvelope;
}

const KIND_ORDER: { kind: DfrobotRegisterKind; title: string }[] = [
  { kind: 'measurement', title: 'Measurements' },
  { kind: 'setting', title: 'Settings' },
  { kind: 'comms', title: 'Comms' },
  { kind: 'info', title: 'Info' },
  { kind: 'undocumented', title: 'Undocumented' },
];

function hexWord(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function signalLabel(signalType: number | null | undefined): string {
  const value = signalType ?? dfrobot_rs485.DfrobotSignalType.DFROBOT_SIGNAL_TYPE_UNSPECIFIED;
  const name = dfrobot_rs485.DfrobotSignalType[value];
  return name ? name.replace(/^DFROBOT_/, '').replace(/_/g, ' ') : String(value);
}

function SummaryCell({ label, value, tone = 'text-accent-data' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded bg-surface-primary p-2">
      <div className="text-[10px] uppercase text-text-label">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs ${tone}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function RegisterRow({ decoded }: { decoded: DecodedDfrobotRegister }) {
  const { spec, raw, value } = decoded;
  const formatted = spec.unit || spec.scale !== 1 || spec.signed
    ? `${formatDfrobotValue(value, spec)} (${hexWord(raw < 0 ? raw + 0x10000 : raw)})`
    : hexWord(raw);
  return (
    <div className="grid grid-cols-[4.5rem_1fr_11rem] gap-2 border-b border-border-subtle py-1 text-xs last:border-b-0">
      <span className="font-mono text-text-muted">{hexWord(spec.register)}</span>
      <span className="truncate text-text-secondary" title={spec.name}>{spec.name}</span>
      <span className="truncate text-right font-mono text-accent-data" title={formatted}>{formatted}</span>
    </div>
  );
}

export default function DfrobotRs485Expanded({ data }: DfrobotRs485ExpandedProps) {
  const device = data.device ?? null;
  const model = device?.model;
  const { known, unknown } = decodeDfrobotRegisters(model, data.ranges);
  const specCount = (DFROBOT_SPECS[model ?? -1] ?? []).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCell
          label="Signal"
          value={signalLabel(data.signalType)}
          tone={data.error ? 'text-accent-critical' : 'text-accent-success'}
        />
        <SummaryCell label="Sensor" value={device?.id ?? 'N/A'} tone="text-accent-info" />
        <SummaryCell label="Model" value={dfrobotModelLabel(model)} tone="text-accent-secondary" />
        <SummaryCell
          label="Bus"
          value={device ? `id ${device.modbusId} @ ${device.baud} baud` : 'N/A'}
          tone="text-accent-warning"
        />
        <SummaryCell label="Port" value={device?.portName || 'N/A'} tone="text-text-secondary" />
        <SummaryCell
          label="Value"
          value={dfrobotPrimaryText(model, data.ranges)}
          tone="text-accent-success"
        />
        <SummaryCell label="Registers" value={`${known.length}/${specCount} known`} tone="text-accent-data" />
      </div>

      {data.error && (
        <div className="rounded bg-surface-primary p-2 text-xs text-accent-critical">
          {data.error}
        </div>
      )}

      {KIND_ORDER.map(({ kind, title }) => {
        const rows = known.filter((decoded) => decoded.spec.kind === kind);
        if (rows.length === 0) {
          return null;
        }
        return (
          <div key={kind} className="rounded bg-surface-primary p-2">
            <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">{title}</div>
            {rows.map((decoded) => (
              <RegisterRow key={decoded.spec.register} decoded={decoded} />
            ))}
          </div>
        );
      })}

      {unknown.length > 0 && (
        <div className="rounded bg-surface-primary p-2">
          <div className="mb-2 border-b border-border-default pb-1 text-xs text-text-label">
            Unmapped registers (polled but not yet named)
          </div>
          {unknown.map(({ register, raw }) => (
            <div key={register} className="grid grid-cols-[4.5rem_1fr] gap-2 border-b border-border-subtle py-1 text-xs last:border-b-0">
              <span className="font-mono text-text-muted">{hexWord(register)}</span>
              <span className="font-mono text-text-secondary">{hexWord(raw)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
