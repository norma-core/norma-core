import type { ChangeEvent } from 'react';
import {
  ROVER_MAX_DRIVE_CURRENT_A,
  ROVER_MIN_DRIVE_CURRENT_LIMIT_A,
} from '../control-input';

const rangeClass = 'appearance-none bg-transparent focus-visible:outline-none [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-3.5 [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:w-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent-data [&::-webkit-slider-thumb]:bg-surface-primary [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(34,211,238,0.14),0_0.35rem_0.8rem_rgba(0,0,0,0.28)] [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:w-9 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent-data [&::-moz-range-thumb]:bg-surface-primary';

interface RoverPowerLimitControlProps {
  value: number;
  onChange: (value: number) => void;
}

function RoverPowerLimitControl({ value, onChange }: RoverPowerLimitControlProps) {
  const progress = ((value - ROVER_MIN_DRIVE_CURRENT_LIMIT_A)
    / (ROVER_MAX_DRIVE_CURRENT_A - ROVER_MIN_DRIVE_CURRENT_LIMIT_A)) * 100;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.valueAsNumber);
  };

  const rangeProps = {
    min: ROVER_MIN_DRIVE_CURRENT_LIMIT_A,
    max: ROVER_MAX_DRIVE_CURRENT_A,
    step: 1,
    value,
    'aria-label': 'Maximum touch drive current',
    'aria-valuetext': `${value} amps`,
    onChange: handleChange,
  };

  return (
    <div className="pointer-events-auto w-[min(5.75rem,24vw)] select-none rounded-md border border-border-default bg-surface-secondary/50 p-1.5 [-webkit-touch-callout:none] lg:w-full lg:p-2 [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(5.75rem,12vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/55 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
      <div className="mb-1 flex items-center justify-between px-0.5 font-mono text-[8px] font-black uppercase tracking-[0.12em] lg:mb-1.5 lg:text-[9px]">
        <span className="text-text-label">Power max</span>
        <output className="text-accent-data">{value}A</output>
      </div>

      <div className="relative mx-auto flex h-[9.75rem] w-full items-center justify-center lg:hidden">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[8.5rem] w-2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-border-default" aria-hidden>
          <span
            className="absolute inset-x-0 bottom-0 rounded-full bg-accent-data transition-[height] duration-75"
            style={{ height: `${progress}%` }}
          />
        </div>
        <span className="pointer-events-none absolute right-0.5 top-1 font-mono text-[7px] font-bold text-text-muted">{ROVER_MAX_DRIVE_CURRENT_A}</span>
        <span className="pointer-events-none absolute bottom-1 right-0.5 font-mono text-[7px] font-bold text-text-muted">{ROVER_MIN_DRIVE_CURRENT_LIMIT_A}</span>
        <input
          {...rangeProps}
          type="range"
          className={`absolute left-1/2 top-1/2 h-11 w-[9.5rem] -translate-x-1/2 -translate-y-1/2 -rotate-90 touch-none ${rangeClass}`}
        />
      </div>

      <div className="hidden lg:block">
        <div className="relative flex h-11 items-center">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-border-default" aria-hidden>
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent-data transition-[width] duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>
          <input {...rangeProps} type="range" className={`relative h-11 w-full ${rangeClass}`} />
        </div>
        <div className="flex justify-between px-0.5 font-mono text-[8px] font-bold text-text-muted">
          <span>{ROVER_MIN_DRIVE_CURRENT_LIMIT_A}A</span>
          <span>{ROVER_MAX_DRIVE_CURRENT_A}A</span>
        </div>
      </div>
    </div>
  );
}

export default RoverPowerLimitControl;
