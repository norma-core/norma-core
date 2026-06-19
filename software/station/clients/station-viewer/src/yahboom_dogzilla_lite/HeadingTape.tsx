import { memo, useCallback, useRef, type PointerEvent } from 'react';

const NEUTRAL = 128;
const TICK_COUNT = 21;

interface HeadingTapeProps {
  yawValue: number;
  isActive: boolean;
  onChange: (value: number) => void;
  onPointerStart: () => void;
  onPointerEnd: () => void;
}

const HeadingTapeComponent = function HeadingTape({
  yawValue,
  isActive,
  onChange,
  onPointerStart,
  onPointerEnd
}: HeadingTapeProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const updateFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const normalized = Math.max(-1, Math.min(1, (event.clientX - centerX) / (rect.width / 2)));
      const next = Math.max(0, Math.min(255, Math.round(NEUTRAL + normalized * 127)));
      onChange(next);
    },
    [onChange]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      onPointerStart();
      updateFromPointer(event);
    },
    [onPointerStart, updateFromPointer]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      updateFromPointer(event);
    },
    [updateFromPointer]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onPointerEnd();
    },
    [onPointerEnd]
  );

  const normalized = (yawValue - NEUTRAL) / 127;
  const percent = Math.round(normalized * 100);
  const caretLeft = `${50 + normalized * 50}%`;
  const readout = isActive ? `${percent > 0 ? '+' : ''}${percent}` : 'READY';
  const valueClassName = `font-extrabold ${
    isActive
      ? 'text-accent-data [text-shadow:0_0_0.4rem_rgba(34,211,238,0.55)]'
      : 'text-text-muted'
  }`;
  const knobClassName = `pointer-events-none absolute top-1/2 h-[1.85rem] w-[1.85rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] transition-[left] duration-[80ms] ease-linear [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[1.55rem] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:w-[1.55rem] ${
    isActive
      ? 'border-accent-data bg-accent-data/30 shadow-[0_0.2rem_0.7rem_rgba(0,0,0,0.22),0_0_1rem_rgba(34,211,238,0.75)]'
      : 'border-accent-data/75 bg-accent-data/15 shadow-[0_0.2rem_0.6rem_rgba(0,0,0,0.18),0_0_0.6rem_rgba(34,211,238,0.40)]'
  }`;

  return (
    <div className="hidden font-mono group-data-[remote-fullscreen=true]/dashboard:col-start-3 group-data-[remote-fullscreen=true]/dashboard:row-start-1 group-data-[remote-fullscreen=true]/dashboard:flex group-data-[remote-fullscreen=true]/dashboard:!w-[min(18rem,24vw)] group-data-[remote-fullscreen=true]/dashboard:flex-col group-data-[remote-fullscreen=true]/dashboard:!gap-2 group-data-[remote-fullscreen=true]/dashboard:justify-self-end group-data-[remote-fullscreen=true]/dashboard:self-end group-data-[remote-fullscreen=true]/dashboard:rounded-lg group-data-[remote-fullscreen=true]/dashboard:border group-data-[remote-fullscreen=true]/dashboard:border-accent-data/30 group-data-[remote-fullscreen=true]/dashboard:bg-surface-primary/45 group-data-[remote-fullscreen=true]/dashboard:!px-4 group-data-[remote-fullscreen=true]/dashboard:!py-3 group-data-[remote-fullscreen=true]/dashboard:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-md group-data-[remote-fullscreen=true]/dashboard:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:col-start-3 [@media(max-width:1023px)_and_(orientation:landscape)]:row-start-1 [@media(max-width:1023px)_and_(orientation:landscape)]:flex [@media(max-width:1023px)_and_(orientation:landscape)]:w-[min(12.5rem,23vw)] [@media(max-width:1023px)_and_(orientation:landscape)]:flex-col [@media(max-width:1023px)_and_(orientation:landscape)]:gap-[0.45rem] [@media(max-width:1023px)_and_(orientation:landscape)]:justify-self-end [@media(max-width:1023px)_and_(orientation:landscape)]:self-end [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-lg [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/45 [@media(max-width:1023px)_and_(orientation:landscape)]:px-[0.6rem] [@media(max-width:1023px)_and_(orientation:landscape)]:py-[0.55rem] [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.16)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:w-[min(11rem,22vw)] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:px-2 [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:py-[0.45rem] [@media(max-width:900px)_and_(orientation:portrait)]:group-data-[remote-fullscreen=true]/dashboard:!hidden">
      <div className="flex items-baseline justify-between text-[0.62rem] font-bold uppercase tracking-[0.14em] text-text-label">
        <span>Yaw</span>
        <span className={valueClassName}>{readout}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Yaw"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={percent}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-[2.6rem] cursor-ew-resize touch-none select-none rounded-full border border-accent-data/30 bg-surface-base/30 shadow-[inset_0_0_1.2rem_rgba(34,211,238,0.08)] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[2.2rem]"
      >
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: TICK_COUNT }, (_, index) => {
            const ratio = index / (TICK_COUNT - 1);
            const isMajor = index % 5 === 0;
            return (
              <span
                key={index}
                className={`absolute w-px -translate-x-1/2 ${
                  isMajor
                    ? 'bottom-[22%] top-[22%] bg-accent-data/50'
                    : 'bottom-[32%] top-[32%] bg-accent-data/25'
                }`}
                style={{ left: `${ratio * 100}%` }}
              />
            );
          })}
        </div>
        <div className="pointer-events-none absolute bottom-[14%] left-1/2 top-[14%] w-0 -translate-x-1/2 border-l border-dashed border-text-primary/30" />
        <div className={knobClassName} style={{ left: caretLeft }}>
          <span className={`absolute inset-[28%] rounded-full ${isActive ? 'bg-accent-data' : 'bg-accent-data/70'}`} aria-hidden />
        </div>
      </div>
    </div>
  );
};

const HeadingTape = memo(HeadingTapeComponent);
HeadingTape.displayName = 'HeadingTape';
export default HeadingTape;
