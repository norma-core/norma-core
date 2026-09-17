import { useRef, type PointerEvent } from 'react';
import type { RoverControlSession } from '../useRoverControlSession';

interface RoverJoystickProps { session: RoverControlSession }
export default function RoverJoystick({ session: { state, actions } }: RoverJoystickProps) {
  const pointer = useRef<number | null>(null);
  function update(event: PointerEvent<HTMLDivElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    actions.setTouchInput((event.clientX - r.left - r.width / 2) / (r.width / 2),
      (event.clientY - r.top - r.height / 2) / (r.height / 2));
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    actions.releaseTouch();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className="rover-joystick" role="group" aria-label="Hold to drive and steer" aria-disabled={state.disabled}
    tabIndex={state.disabled ? -1 : 0}
    onPointerDown={event => {
      if (state.disabled || pointer.current !== null || event.button !== 0) return;
      event.preventDefault();
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      actions.startTouch(); update(event);
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId && !state.disabled) update(event); }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <span className="rover-north">Forward</span><span className="rover-south">Reverse</span>
    <span className="rover-west">L</span><span className="rover-east">R</span>
    <span className={`rover-stick ${state.active ? 'active' : ''}`} style={{ left: `${50 + state.axes.x * 32}%`, top: `${50 + state.axes.y * 32}%` }} />
  </div>;
}
