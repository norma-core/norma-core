import { ChevronRight, PlugZap, SunMedium } from 'lucide-react';
import type { VictronTextValues } from '@/devices/victron-smartsolar-mppt/values';
import { buildRoverEnergyState, type BatteryFlowMode } from '../battery-state';

interface RoverEnergyFlowProps {
  values: VictronTextValues;
  fallbackBatteryVoltageV?: number | null;
  linkLabel: string;
  linkStale: boolean;
}

function valueOrDash(value: number | null, digits: number, suffix: string): string {
  return value === null ? '--' : `${value.toFixed(digits)}${suffix}`;
}

function batteryModeLabel(mode: BatteryFlowMode): string {
  switch (mode) {
    case 'charging': return 'Charging';
    case 'discharging': return 'Discharging';
    case 'idle': return 'Idle';
    default: return 'Current N/A';
  }
}

function FlowLine({ active }: { active: boolean }) {
  return (
    <div className={`relative mx-1 h-px min-w-4 flex-1 overflow-visible ${active ? 'bg-accent-data/65' : 'bg-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:bg-white/20'}`}>
      {active && <span className="absolute inset-0 animate-pulse bg-accent-data shadow-[0_0_0.6rem_rgba(34,211,238,0.65)]" />}
      <ChevronRight className={`absolute -right-1.5 -top-1.5 h-3 w-3 ${active ? 'text-accent-data' : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/45'}`} />
    </div>
  );
}

export default function RoverEnergyFlow({
  values,
  fallbackBatteryVoltageV,
  linkLabel,
  linkStale,
}: RoverEnergyFlowProps) {
  const energy = buildRoverEnergyState(values, fallbackBatteryVoltageV);
  const batteryPercent = energy.batterySocPercent;
  const batteryFill = batteryPercent === null
    ? 'bg-text-muted'
    : batteryPercent <= 10
      ? 'bg-accent-critical'
      : batteryPercent <= 20
        ? 'bg-accent-warning'
        : 'bg-accent-success';
  const loadLabel = energy.loadOn === false ? 'Off' : valueOrDash(energy.loadPowerW, 1, 'W');
  const batteryFlowLabel = batteryModeLabel(energy.batteryMode);
  const batteryFlowDescription = energy.batteryMode === 'unavailable'
    ? 'Battery current data unavailable'
    : batteryFlowLabel;

  return (
    <section
      aria-label={`Energy flow. Solar ${valueOrDash(energy.solarPowerW, 0, ' watts')}. Battery ${batteryPercent === null ? 'state unavailable' : `approximately ${batteryPercent} percent`}. Load ${loadLabel}.`}
      className="w-full"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
        <span>12V LiFePO₄ energy</span>
        <span className={linkStale ? 'text-accent-critical' : 'text-accent-success'}>Link {linkLabel}</span>
      </div>

      <div className="grid grid-cols-[minmax(3.3rem,0.72fr)_minmax(1rem,0.35fr)_minmax(6.4rem,1.25fr)_minmax(1rem,0.35fr)_minmax(3.3rem,0.72fr)] items-center [@media(max-width:1023px)_and_(orientation:landscape)]:grid-cols-[minmax(2.5rem,0.7fr)_minmax(0.5rem,0.25fr)_minmax(5.6rem,1.25fr)_minmax(0.5rem,0.25fr)_minmax(2.5rem,0.7fr)]">
        <div className="min-w-0 text-center">
          <div className="[@media(max-width:1023px)_and_(orientation:landscape)]:flex [@media(max-width:1023px)_and_(orientation:landscape)]:items-center [@media(max-width:1023px)_and_(orientation:landscape)]:justify-center [@media(max-width:1023px)_and_(orientation:landscape)]:gap-1.5">
            <SunMedium className={`mx-auto h-4 w-4 [@media(max-width:1023px)_and_(orientation:landscape)]:mx-0 [@media(max-width:1023px)_and_(orientation:landscape)]:shrink-0 ${energy.solarActive ? 'text-accent-data' : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/50'}`} />
            <div className={`mt-0.5 truncate font-mono text-xs font-black tabular-nums [@media(max-width:1023px)_and_(orientation:landscape)]:mt-0 ${energy.solarActive ? 'text-accent-data' : 'text-text-secondary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/75'}`}>
              {valueOrDash(energy.solarPowerW, 0, 'W')}
            </div>
          </div>
          <div className="truncate font-mono text-[9px] text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60">Solar · {valueOrDash(energy.panelVoltageV, 1, 'V')}</div>
        </div>

        <FlowLine active={energy.solarActive} />

        <div className="flex min-w-0 items-center justify-center gap-2">
          <div
            role="img"
            aria-label={`Battery ${batteryPercent === null ? 'state unavailable' : `approximately ${batteryPercent} percent`}`}
            title="Approximate state of charge from battery voltage; charging and load affect the estimate"
            className="relative h-8 w-14 shrink-0 rounded-[5px] border border-border-default bg-surface-base/45 after:absolute after:-right-1.5 after:top-2 after:h-3 after:w-1 after:rounded-r-sm after:bg-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:border-white/45 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-black/25 [@media(max-width:1023px)_and_(orientation:landscape)]:after:bg-white/45"
          >
            <div className="absolute inset-0.5 overflow-hidden rounded-[3px] bg-surface-tertiary/35 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-white/10">
              <div
                className={`absolute inset-y-0 left-0 transition-[width,background-color] duration-500 ${batteryFill}`}
                style={{ width: `${batteryPercent === null ? 0 : Math.max(4, batteryPercent)}%` }}
              />
            </div>
            <span className="absolute inset-0 z-10 flex items-center justify-center font-mono text-[10px] font-black tabular-nums text-white">
              <span className="rounded-sm bg-black/55 px-1 py-px leading-none shadow-sm">
                {batteryPercent === null ? '--' : `≈${batteryPercent}%`}
              </span>
            </span>
          </div>
          <div className="min-w-0">
            <div className="whitespace-nowrap font-mono text-[10px] font-bold text-text-primary [@media(max-width:1023px)_and_(orientation:landscape)]:text-[9px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white">
              <span className="[@media(max-width:1023px)_and_(orientation:landscape)]:hidden">
                {valueOrDash(energy.batteryVoltageV, 2, 'V')} · {valueOrDash(energy.batteryCurrentA, 1, 'A')}
              </span>
              <span className="hidden [@media(max-width:1023px)_and_(orientation:landscape)]:inline">
                {valueOrDash(energy.batteryVoltageV, 1, 'V')} · {valueOrDash(energy.batteryCurrentA, 1, 'A')}
              </span>
            </div>
            <div
              aria-label={batteryFlowDescription}
              title={energy.batteryMode === 'unavailable' ? batteryFlowDescription : undefined}
              className="truncate text-[9px] font-semibold uppercase tracking-wide text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60"
            >
              {batteryFlowLabel}
            </div>
          </div>
        </div>

        <FlowLine active={energy.loadActive} />

        <div className="min-w-0 text-center">
          <div className="[@media(max-width:1023px)_and_(orientation:landscape)]:flex [@media(max-width:1023px)_and_(orientation:landscape)]:items-center [@media(max-width:1023px)_and_(orientation:landscape)]:justify-center [@media(max-width:1023px)_and_(orientation:landscape)]:gap-1.5">
            <PlugZap className={`mx-auto h-4 w-4 [@media(max-width:1023px)_and_(orientation:landscape)]:mx-0 [@media(max-width:1023px)_and_(orientation:landscape)]:shrink-0 ${energy.loadActive ? 'text-accent-data' : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/50'}`} />
            <div className={`mt-0.5 truncate font-mono text-xs font-black tabular-nums [@media(max-width:1023px)_and_(orientation:landscape)]:mt-0 ${energy.loadActive ? 'text-text-primary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white' : 'text-text-secondary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/75'}`}>
              {loadLabel}
            </div>
          </div>
          <div className="truncate font-mono text-[9px] text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60">Load · {valueOrDash(energy.loadCurrentA, 2, 'A')}</div>
        </div>
      </div>
    </section>
  );
}
