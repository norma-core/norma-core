import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const JOYSTICK_TRAVEL_PERCENT = 38;

interface RoverJoystickProps {
  axes: { x: number; y: number };
  currentA: number;
  steeringDeg: number;
  active: boolean;
  touchActive: boolean;
  onStart: () => void;
  onInput: (x: number, y: number) => void;
  onRelease: () => void;
}

function RoverJoystick({
  axes,
  currentA,
  steeringDeg,
  active,
  touchActive,
  onStart,
  onInput,
  onRelease,
}: RoverJoystickProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    onInput(
      (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2),
      (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2),
    );
  }, [onInput]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onStart();
    updateFromPointer(event);
  }, [onStart, updateFromPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) updateFromPointer(event);
  }, [updateFromPointer]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onRelease();
  }, [onRelease]);

  const knobLeft = 50 + axes.x * JOYSTICK_TRAVEL_PERCENT;
  const knobTop = 50 + axes.y * JOYSTICK_TRAVEL_PERCENT;

  return (
    <div className="pointer-events-auto w-[min(13.5rem,56vw)] min-w-0 select-none [-webkit-touch-callout:none] lg:w-auto [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(15.25rem,31vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/45 [@media(max-width:1023px)_and_(orientation:landscape)]:p-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1 [@media(max-width:1023px)_and_(orientation:landscape)]:mb-1 [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.58rem]">
        <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.16em] text-text-label [@media(max-width:1023px)_and_(orientation:landscape)]:hidden">Drive + steer</span>
        <span className="hidden whitespace-nowrap font-bold uppercase tracking-[0.12em] text-text-label [@media(max-width:1023px)_and_(orientation:landscape)]:inline">Drive + steer</span>
        <span className={`font-mono text-[9px] font-bold uppercase [@media(max-width:1023px)_and_(orientation:landscape)]:text-[0.58rem] ${active ? 'text-accent-data' : 'text-text-muted'}`}>
          {active ? '[ live ]' : '[ idle ]'}
        </span>
      </div>
      <div className="mb-1 hidden text-center font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted lg:block">WASD · ±10A limit</div>
      <div
        ref={padRef}
        role="slider"
        aria-label="Rover drive and steering"
        aria-valuetext={`${currentA.toFixed(1)} amps, ${steeringDeg} degrees`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        className="relative mx-auto aspect-square w-full touch-none rounded-2xl border border-border-default bg-surface-base shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25),inset_0_0_3rem_rgba(34,211,238,0.06)] outline-none focus-visible:ring-2 focus-visible:ring-accent-data lg:h-48 lg:w-48 [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-base/30 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45),inset_0_0_4rem_rgba(34,211,238,0.08),0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md"
      >
        <span className="pointer-events-none absolute -left-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-l-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
        <span className="pointer-events-none absolute -right-1 -top-1 z-[1] hidden h-2.5 w-2.5 border-r-2 border-t-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
        <span className="pointer-events-none absolute -bottom-1 -left-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-l-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
        <span className="pointer-events-none absolute -bottom-1 -right-1 z-[1] hidden h-2.5 w-2.5 border-b-2 border-r-2 border-accent-data/75 [@media(max-width:1023px)_and_(orientation:landscape)]:block" aria-hidden />
        <span className="pointer-events-none absolute inset-[18%] rounded-xl border border-border-subtle" />
        <span className="pointer-events-none absolute inset-[34%] rounded-lg border border-border-subtle" />
        <span className="pointer-events-none absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-border-default" />
        <span className="pointer-events-none absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-border-default" />
        <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-[8px] font-black uppercase tracking-[0.18em] text-accent-data/75">Fwd</span>
        <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">Rev</span>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[7px] font-black uppercase tracking-[0.12em] text-text-muted">Left</span>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[7px] font-black uppercase tracking-[0.12em] text-text-muted">Right</span>
        <span
          className={`pointer-events-none absolute h-[24%] w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0.6rem_1.4rem_rgba(0,0,0,0.24)] transition-[transform,background-color,border-color] duration-75 ${touchActive ? 'scale-105 border-accent-data bg-accent-data shadow-[0_0_0.8rem_rgba(34,211,238,0.45)]' : 'border-accent-data/70 bg-accent-data/10'}`}
          style={{ left: `${knobLeft}%`, top: `${knobTop}%` }}
        />
      </div>
    </div>
  );
}

export default RoverJoystick;
