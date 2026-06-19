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

  return (
    <div className="dogzilla-heading-tape" data-active={isActive ? 'true' : undefined}>
      <div className="dogzilla-heading-tape-header">
        <span className="dogzilla-heading-tape-title">Yaw</span>
        <span className="dogzilla-heading-tape-value">{readout}</span>
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
        className="dogzilla-heading-tape-track touch-none select-none"
      >
        <div className="dogzilla-heading-tape-ticks">
          {Array.from({ length: TICK_COUNT }, (_, index) => {
            const ratio = index / (TICK_COUNT - 1);
            const isMajor = index % 5 === 0;
            return (
              <span
                key={index}
                className={`dogzilla-heading-tape-tick${isMajor ? ' dogzilla-heading-tape-tick-major' : ''}`}
                style={{ left: `${ratio * 100}%` }}
              />
            );
          })}
        </div>
        <div className="dogzilla-heading-tape-reticle" />
        <div className="dogzilla-heading-tape-knob" style={{ left: caretLeft }}>
          <span className="dogzilla-heading-tape-knob-dot" aria-hidden />
        </div>
      </div>
    </div>
  );
};

const HeadingTape = memo(HeadingTapeComponent);
HeadingTape.displayName = 'HeadingTape';
export default HeadingTape;
