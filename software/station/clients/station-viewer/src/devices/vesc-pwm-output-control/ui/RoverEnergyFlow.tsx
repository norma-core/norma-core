import { ChevronRight, PlugZap, SunMedium } from 'lucide-react';
import type { VictronTextValues } from '@/devices/victron-smartsolar-mppt/values';
import { buildRoverEnergyState, type RoverEnergyState } from '../battery-state';
import RoverBatteryIndicator from './RoverBatteryIndicator';

interface RoverEnergyFlowProps {
  values: VictronTextValues;
  fallbackBatteryVoltageV?: number | null;
  linkLabel: string;
  linkStale: boolean;
}

function valueOrDash(value: number | null, digits: number, suffix: string): string {
  return value === null ? '--' : `${value.toFixed(digits)}${suffix}`;
}

type PowerSummaryIntent = 'solar' | 'battery' | 'idle' | 'unknown';

interface PowerSummary {
  label: string;
  intent: PowerSummaryIntent;
}

function getPowerSummary(energy: RoverEnergyState): PowerSummary {
  if (energy.batteryMode === 'charging') {
    return { label: energy.solarActive ? 'Charging from solar' : 'Battery charging', intent: 'solar' };
  }

  if (energy.batteryMode === 'discharging') {
    return {
      label: energy.solarActive ? 'Solar + battery' : 'Powered by battery',
      intent: 'battery',
    };
  }

  if (energy.batteryMode === 'idle') {
    if (energy.solarActive && energy.loadActive) return { label: 'Powered by solar', intent: 'solar' };
    if (energy.solarActive) return { label: 'Solar available', intent: 'solar' };
    if (energy.loadActive) return { label: 'Load active', intent: 'unknown' };
    return { label: 'System idle', intent: 'idle' };
  }

  if (energy.solarActive && energy.loadActive) {
    const solarCoversLoad = energy.solarPowerW !== null
      && energy.loadPowerW !== null
      && energy.solarPowerW + 0.5 >= energy.loadPowerW;
    return solarCoversLoad
      ? { label: 'Powered by solar', intent: 'solar' }
      : { label: 'Solar assists load', intent: 'unknown' };
  }

  if (energy.loadActive) return { label: 'Powered by battery', intent: 'battery' };
  if (energy.solarActive) return { label: 'Solar available', intent: 'solar' };

  const powerDataUnavailable = energy.solarPowerW === null
    && energy.loadPowerW === null
    && energy.batteryCurrentA === null;
  return powerDataUnavailable
    ? { label: 'Power data unavailable', intent: 'unknown' }
    : { label: 'System idle', intent: 'idle' };
}

function FlowLine({ active }: { active: boolean }) {
  return (
    <div className={`relative mx-1 mt-2 h-px min-w-3 flex-1 overflow-visible ${active ? 'bg-accent-data/75 shadow-[0_0_0.45rem_rgba(34,211,238,0.35)]' : 'bg-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:bg-white/20'}`}>
      {active && <ChevronRight className="absolute -right-1.5 -top-1.5 h-3 w-3 text-accent-data" aria-hidden="true" />}
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
  const loadLabel = energy.loadOn === false ? 'Off' : valueOrDash(energy.loadPowerW, 1, 'W');
  const powerSummary = getPowerSummary(energy);
  const powerSummaryColor = powerSummary.intent === 'solar' || powerSummary.intent === 'battery'
    ? 'text-accent-data'
    : powerSummary.intent === 'unknown'
      ? 'text-accent-warning'
      : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60';

  return (
    <section
      aria-label={`Energy flow. Solar ${valueOrDash(energy.solarPowerW, 0, ' watts')}. Battery ${batteryPercent === null ? 'state unavailable' : `approximately ${batteryPercent} percent`}. Load ${loadLabel}.`}
      className="w-full"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] [@media(max-width:1023px)_and_(orientation:landscape)]:mb-0.5 [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px]">
        <span className={`min-w-0 truncate ${powerSummaryColor}`}>{powerSummary.label}</span>
        <span className={linkStale ? 'text-accent-critical' : 'text-accent-success'}>Link {linkLabel}</span>
      </div>

      <div className="grid grid-cols-[minmax(3.3rem,0.8fr)_minmax(0.75rem,0.3fr)_minmax(3.5rem,0.8fr)_minmax(0.75rem,0.3fr)_minmax(3.3rem,0.8fr)] items-start lg:grid-cols-[minmax(3.3rem,0.72fr)_minmax(0.75rem,0.3fr)_minmax(6.4rem,1.35fr)_minmax(0.75rem,0.3fr)_minmax(3.3rem,0.72fr)] [@media(max-width:1023px)_and_(orientation:landscape)]:grid-cols-[minmax(2.5rem,0.7fr)_minmax(0.4rem,0.3fr)_minmax(3.5rem,0.8fr)_minmax(0.4rem,0.3fr)_minmax(2.5rem,0.7fr)]">
        <div className="min-w-0 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <SunMedium className={`h-4 w-4 shrink-0 ${energy.solarActive ? 'text-accent-data' : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/50'}`} />
            <div className={`truncate font-mono text-xs font-black tabular-nums ${energy.solarActive ? 'text-accent-data' : 'text-text-secondary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/75'}`}>
              {valueOrDash(energy.solarPowerW, 0, 'W')}
            </div>
          </div>
          <div
            title={energy.panelVoltageV === null ? undefined : `Panel ${valueOrDash(energy.panelVoltageV, 1, 'V')}`}
            className="truncate font-mono text-[9px] uppercase tracking-wide text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60"
          >
            Solar
          </div>
        </div>

        <FlowLine active={energy.solarActive} />

        <RoverBatteryIndicator energy={energy} />

        <FlowLine active={energy.loadActive} />

        <div className="min-w-0 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <PlugZap className={`h-4 w-4 shrink-0 ${energy.loadActive ? 'text-accent-data' : 'text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/50'}`} />
            <div className={`truncate font-mono text-xs font-black tabular-nums ${energy.loadActive ? 'text-text-primary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white' : 'text-text-secondary [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/75'}`}>
              {loadLabel}
            </div>
          </div>
          <div
            title={energy.loadCurrentA === null ? undefined : `Load ${valueOrDash(energy.loadCurrentA, 2, 'A')}`}
            className="truncate font-mono text-[9px] uppercase tracking-wide text-text-muted [@media(max-width:1023px)_and_(orientation:landscape)]:text-[8px] [@media(max-width:1023px)_and_(orientation:landscape)]:text-white/60"
          >
            Load
          </div>
        </div>
      </div>
    </section>
  );
}
