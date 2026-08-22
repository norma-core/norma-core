import type { VescTrampaValues } from '@/devices/vesc-trampa/values-parser';

interface RoverDriveSummaryProps {
  values: VescTrampaValues | null;
  ready: boolean;
  hasFault: boolean;
  ageLabel: string;
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

export default function RoverDriveSummary({
  values,
  ready,
  hasFault,
  ageLabel,
}: RoverDriveSummaryProps) {
  const stateLabel = hasFault ? 'Fault' : ready ? 'Ready' : 'Waiting';
  const stateTone = hasFault
    ? 'text-accent-critical'
    : ready
      ? 'text-accent-success'
      : 'text-accent-warning';

  return (
    <section aria-label="Drivetrain summary" className="hidden shrink-0 border-b border-border-default px-5 py-4 lg:block">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-text-label">Drivetrain</h2>
        <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${stateTone}`}>
          {stateLabel} · {ageLabel}
        </span>
      </div>
      <dl className="grid grid-cols-4 divide-x divide-border-default">
        <div className="min-w-0 pr-3">
          <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">RPM</dt>
          <dd className="mt-1 truncate font-mono text-sm font-black tabular-nums text-text-primary">{integerValue(values?.rpm)}</dd>
        </div>
        <div className="min-w-0 px-3">
          <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Input</dt>
          <dd className="mt-1 truncate font-mono text-sm font-black tabular-nums text-accent-data">{numberValue(values?.avgInputCurrentA, 1, 'A')}</dd>
        </div>
        <div className="min-w-0 px-3">
          <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">FET</dt>
          <dd className={`mt-1 truncate font-mono text-sm font-black tabular-nums ${(values?.tempFetC ?? 0) > 65 ? 'text-accent-critical' : 'text-text-primary'}`}>
            {numberValue(values?.tempFetC, 1, '°')}
          </dd>
        </div>
        <div className="min-w-0 pl-3">
          <dt className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Fault</dt>
          <dd className={`mt-1 truncate font-mono text-sm font-black tabular-nums ${values?.faultCode ? 'text-accent-critical' : 'text-accent-success'}`}>
            {values?.faultCode ?? '--'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
