import { useEffect, useId, useRef, useState } from 'react';
import type { BatteryFlowMode, RoverEnergyState } from '../battery-state';

interface RoverBatteryIndicatorProps {
  energy: RoverEnergyState;
}

function valueOrDash(value: number | null, digits: number, suffix: string): string {
  return value === null ? '--' : `${value.toFixed(digits)}${suffix}`;
}

function signedValueOrDash(value: number | null, digits: number, suffix: string): string {
  if (value === null) return '--';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`;
}

function batteryModeLabel(mode: BatteryFlowMode, batteryPercent: number | null): string {
  switch (mode) {
    case 'charging': return 'Charging';
    case 'discharging': return 'Discharging';
    case 'idle': return batteryPercent !== null && batteryPercent >= 95 ? 'Full' : 'Standby';
    default: return 'Unknown';
  }
}

function BatteryJunction({ mode, busActive }: { mode: BatteryFlowMode; busActive: boolean }) {
  const batteryActive = mode === 'charging' || mode === 'discharging';

  return (
    <span className="relative mx-auto block h-4 w-4" aria-hidden="true">
      <span className={`absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full border ${busActive ? 'border-accent-data bg-accent-data shadow-[0_0_0.45rem_rgba(34,211,238,0.5)]' : 'border-border-default bg-surface-primary [@media(max-width:1023px)_and_(orientation:landscape)]:border-white/40 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-black/35'}`} />
      <span className={`absolute bottom-0 left-1/2 top-3 border-l ${batteryActive ? 'border-solid border-accent-data/80' : 'border-dashed border-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:border-white/30'}`} />
    </span>
  );
}

export default function RoverBatteryIndicator({ energy }: RoverBatteryIndicatorProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const batteryPercent = energy.batterySocPercent;
  const batteryFlowLabel = batteryModeLabel(energy.batteryMode, batteryPercent);
  const batteryFlowDescription = energy.batteryMode === 'unavailable'
    ? 'Battery current data unavailable'
    : batteryFlowLabel;
  const batteryFill = batteryPercent === null
    ? 'bg-text-muted'
    : batteryPercent < 10
      ? 'bg-accent-critical'
      : batteryPercent < 20
        ? 'bg-accent-warning'
        : 'bg-accent-success';
  const batteryFrame = batteryPercent !== null && batteryPercent < 10
    ? 'border-accent-critical/80 after:bg-accent-critical'
    : batteryPercent !== null && batteryPercent < 20
      ? 'border-accent-warning/80 after:bg-accent-warning'
      : 'border-border-default after:bg-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:border-white/45 [@media(max-width:1023px)_and_(orientation:landscape)]:after:bg-white/45';
  const busActive = energy.solarActive
    || energy.loadActive
    || energy.batteryMode === 'charging'
    || energy.batteryMode === 'discharging';

  useEffect(() => {
    if (!detailsOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        setDetailsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailsOpen]);

  return (
    <div
      ref={controlRef}
      className="group/battery relative min-w-0"
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setDetailsOpen(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setDetailsOpen(false); }}
    >
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-describedby={detailsId}
        aria-label={`Battery ${batteryPercent === null ? 'state unavailable' : `approximately ${batteryPercent} percent`}, ${batteryFlowLabel}. Show exact telemetry`}
        onClick={() => {
          const touchLike = window.matchMedia('(hover: none), (pointer: coarse)').matches;
          setDetailsOpen((current) => touchLike ? !current : true);
        }}
        onFocus={() => setDetailsOpen(true)}
        onBlur={(event) => {
          if (!controlRef.current?.contains(event.relatedTarget as Node | null)) {
            setDetailsOpen(false);
          }
        }}
        className="mx-auto flex h-11 w-full min-w-0 flex-col items-center justify-start rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-data"
      >
        <BatteryJunction mode={energy.batteryMode} busActive={busActive} />
        <span className="flex min-w-0 items-center justify-center gap-1.5">
          <span
            role="img"
            aria-label={`Battery ${batteryPercent === null ? 'state unavailable' : `approximately ${batteryPercent} percent`}`}
            className={`relative h-7 w-12 shrink-0 rounded-[5px] border bg-surface-base/45 after:absolute after:-right-1 after:top-2 after:h-2.5 after:w-0.5 after:rounded-r-sm [@media(max-width:1023px)_and_(orientation:landscape)]:bg-black/25 ${batteryFrame}`}
          >
            <span className="absolute inset-0.5 overflow-hidden rounded-[3px] bg-surface-tertiary/35 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-white/10">
              <span
                className={`absolute inset-y-0 left-0 transition-[width,background-color] duration-500 ${batteryFill}`}
                style={{ width: `${batteryPercent === null ? 0 : Math.max(4, batteryPercent)}%` }}
              />
            </span>
            <span className="absolute inset-0 z-10 flex items-center justify-center font-mono text-[9px] font-black tabular-nums text-white">
              <span className="rounded-sm bg-black/55 px-0.5 py-px leading-none shadow-sm">
                {batteryPercent === null ? '--' : `≈${batteryPercent}%`}
              </span>
            </span>
          </span>
          <span
            aria-label={batteryFlowDescription}
            className={`hidden truncate text-[9px] font-bold uppercase tracking-wide lg:inline ${energy.batteryMode === 'charging' || energy.batteryMode === 'discharging' ? 'text-accent-data' : energy.batteryMode === 'idle' && batteryPercent !== null && batteryPercent >= 95 ? 'text-accent-success' : 'text-text-muted'}`}
          >
            {energy.batteryMode === 'charging' && <span aria-hidden="true">↓ </span>}
            {energy.batteryMode === 'discharging' && <span aria-hidden="true">↑ </span>}
            {batteryFlowLabel}
          </span>
        </span>
      </button>

      <div
        id={detailsId}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-40 -translate-x-1/2 rounded-md border border-border-default bg-surface-primary/96 px-3 py-2 text-left shadow-xl backdrop-blur-md transition-[opacity,transform,visibility] duration-150 ${detailsOpen ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'}`}
      >
        <div className="mb-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Battery telemetry</div>
        <dl className="space-y-1 font-mono text-[9px] tabular-nums">
          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">State</dt><dd className="font-bold uppercase text-text-primary">{batteryFlowLabel}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">Voltage</dt><dd className="font-bold text-text-primary">{valueOrDash(energy.batteryVoltageV, 2, 'V')}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">Current</dt><dd className="font-bold text-text-primary">{signedValueOrDash(energy.batteryCurrentA, 2, 'A')}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">SOC estimate</dt><dd className="font-bold text-text-primary">{batteryPercent === null ? '--' : `≈${batteryPercent}%`}</dd></div>
        </dl>
      </div>
    </div>
  );
}
