import type { RoverControlSession } from '../useRoverControlSession';
import RoverJoystick from './RoverJoystick';
interface RoverDriveControlsProps { session: RoverControlSession }
export default function RoverDriveControls({ session }: RoverDriveControlsProps) {
  const { state } = session;
  return <section className="rover-drive rover-panel" aria-label="Driving controls">
    <div className="rover-panel-heading"><span>Drive</span><output>{state.disabled ? 'Unavailable' : state.active ? 'Input held' : 'Released'}</output></div>
    <RoverJoystick session={session} />
    <div className="rover-drive-readout"><span>{state.rpm ? `${state.rpm < 0 ? 'FWD' : 'REV'} · ${Math.abs(state.rpm)} RPM REQUEST` : state.axes.x ? 'STEERING REQUEST' : 'NO DRIVE REQUEST'}</span><span className="rover-key-hint">W A S D</span></div>
    {state.error && <div className="rover-error" role="alert">{state.error}</div>}
  </section>;
}
