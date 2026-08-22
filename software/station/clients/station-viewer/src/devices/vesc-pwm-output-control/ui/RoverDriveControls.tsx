import {
  Crosshair,
  Gauge,
  Octagon,
  Power,
} from 'lucide-react';
import { PWM_OUTPUT_STEERING_CENTER_DEG } from '@/devices/pwm-output/commands';
import type { RoverControlSession } from '../useRoverControlSession';
import RoverJoystick from './RoverJoystick';
import RoverPowerLimitControl from './RoverPowerLimitControl';

const actionButtonClass = 'flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border-default bg-surface-secondary/60 px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-text-primary transition hover:border-accent-data/50 hover:bg-accent-data/8 active:scale-[0.98] active:bg-accent-data/14 disabled:cursor-not-allowed disabled:opacity-35';

interface RoverDriveControlsProps {
  session: RoverControlSession;
  onOpenDetails: () => void;
}

function RoverDriveControls({ session, onOpenDetails }: RoverDriveControlsProps) {
  const { state, actions } = session;

  return (
    <div className="flex min-h-0 flex-1 flex-row items-end justify-between gap-2 px-4 py-3 lg:flex-col lg:items-center lg:justify-center lg:gap-4 lg:px-6 lg:py-5 [@media(min-width:1024px)_and_(max-height:899px)]:gap-2 [@media(min-width:1024px)_and_(max-height:899px)]:px-4 [@media(min-width:1024px)_and_(max-height:899px)]:py-2 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:bottom-[calc(0.5rem+env(safe-area-inset-bottom))] [@media(max-width:1023px)_and_(orientation:landscape)]:left-[calc(0.5rem+env(safe-area-inset-left))] [@media(max-width:1023px)_and_(orientation:landscape)]:right-[calc(0.5rem+env(safe-area-inset-right))] [@media(max-width:1023px)_and_(orientation:landscape)]:p-0">
      <RoverJoystick
        axes={state.axes}
        currentA={state.currentA}
        steeringDeg={state.steeringDeg}
        active={state.active}
        touchActive={state.touchActive}
        onStart={actions.startTouch}
        onInput={actions.setTouchInput}
        onRelease={actions.releaseTouch}
      />

      <RoverPowerLimitControl
        value={state.currentLimitA}
        onChange={actions.setCurrentLimit}
      />

      <div className="pointer-events-auto hidden min-w-0 flex-col gap-2 lg:flex lg:w-full">
        <button
          type="button"
          onClick={actions.stop}
          disabled={!state.canSendDrive && !state.canSendSteering}
          className="flex min-h-14 items-center justify-center gap-2 rounded-md border border-accent-critical-deep bg-accent-critical/12 px-3 text-xs font-black uppercase tracking-[0.12em] text-accent-critical transition hover:border-accent-critical hover:bg-accent-critical/20 active:scale-[0.98] active:bg-accent-critical/25 disabled:opacity-35 [@media(min-width:1024px)_and_(max-height:899px)]:min-h-11"
        >
          <Octagon className="h-4 w-4" />Stop
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={actionButtonClass} onClick={actions.center} disabled={!state.canSendSteering}>
            <Crosshair className="h-3.5 w-3.5" />Center
          </button>
          <button type="button" className={actionButtonClass} onClick={() => void actions.hold()} disabled={!state.canSendDrive || state.holding}>
            <Octagon className="h-3.5 w-3.5" />{state.holding ? 'Wait' : 'Hold'}
          </button>
          <button type="button" className={actionButtonClass} onClick={() => void actions.disableSteering()} disabled={!state.canSendSteering}>
            <Power className="h-3.5 w-3.5" />Disable
          </button>
          <button type="button" className={actionButtonClass} onClick={onOpenDetails}>
            <Gauge className="h-3.5 w-3.5" />Status
          </button>
        </div>
        <div className="grid grid-cols-3 border-y border-border-default py-1.5 font-mono tabular-nums">
          <div className="border-r border-border-default px-1 text-center">
            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Drive</div>
            <div className={`mt-0.5 text-[10px] font-bold ${state.currentA === 0 ? 'text-text-secondary' : 'text-accent-data'}`}>
              {state.currentA.toFixed(1)}A
            </div>
          </div>
          <div className="border-r border-border-default px-1 text-center">
            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">Steer</div>
            <div className={`mt-0.5 text-[10px] font-bold ${state.steeringDeg === PWM_OUTPUT_STEERING_CENTER_DEG ? 'text-text-secondary' : 'text-accent-data'}`}>
              {state.steeringDeg}°
            </div>
          </div>
          <div className="px-1 text-center">
            <div className="text-[7px] font-bold uppercase tracking-[0.12em] text-text-muted">Pulse</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-secondary">{state.pulseWidthUs}µs</div>
          </div>
        </div>
        {state.error && (
          <div className="truncate rounded bg-accent-critical/12 px-2 py-1.5 text-[9px] font-semibold text-accent-critical">
            {state.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default RoverDriveControls;
