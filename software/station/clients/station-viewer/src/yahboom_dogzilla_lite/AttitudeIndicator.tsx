import { memo } from 'react';

interface AttitudeIndicatorProps {
  roll: number;
  pitch: number;
}

const PITCH_RANGE = 30;
const PITCH_SCALE = 18;

const AttitudeIndicatorComponent = function AttitudeIndicator({ roll, pitch }: AttitudeIndicatorProps) {
  const clampedRoll = Math.max(-45, Math.min(45, roll));
  const clampedPitch = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, pitch));
  const pitchOffset = (clampedPitch / PITCH_RANGE) * PITCH_SCALE;

  return (
    <div className="relative h-16 w-16 overflow-hidden group-data-[remote-fullscreen=true]/dashboard:!h-[4rem] group-data-[remote-fullscreen=true]/dashboard:!w-[4rem] group-data-[remote-fullscreen=true]/dashboard:rounded-md group-data-[remote-fullscreen=true]/dashboard:border group-data-[remote-fullscreen=true]/dashboard:border-accent-data/40 group-data-[remote-fullscreen=true]/dashboard:bg-surface-primary/50 group-data-[remote-fullscreen=true]/dashboard:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] group-data-[remote-fullscreen=true]/dashboard:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)]:h-[3.6rem] [@media(max-width:1023px)_and_(orientation:landscape)]:w-[3.6rem] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-md [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/40 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-surface-primary/50 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.18)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:h-[3.2rem] [@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:520px)]:w-[3.2rem]">
      <svg viewBox="-32 -32 64 64" className="absolute inset-0 h-full w-full">
        <g transform={`rotate(${-clampedRoll})`}>
          <g transform={`translate(0 ${pitchOffset})`}>
            <rect x="-64" y="-64" width="128" height="64" fill="var(--color-accent-data)" fillOpacity="0.08" />
            <rect x="-64" y="0" width="128" height="64" fill="var(--color-accent-warning)" fillOpacity="0.1" />
            <line x1="-30" y1="0" x2="30" y2="0" stroke="var(--color-accent-data)" strokeWidth="1.2" />
            {[-20, -10, 10, 20].map((p) => {
              const y = -(p / PITCH_RANGE) * PITCH_SCALE;
              const len = Math.abs(p) === 10 ? 4 : 7;
              return (
                <line
                  key={p}
                  x1={-len}
                  y1={y}
                  x2={len}
                  y2={y}
                  stroke="var(--color-accent-data)"
                  strokeWidth="0.6"
                  strokeOpacity="0.55"
                />
              );
            })}
          </g>
        </g>
        <line x1="-12" y1="0" x2="-4" y2="0" stroke="var(--color-text-primary)" strokeWidth="1.2" />
        <line x1="4" y1="0" x2="12" y2="0" stroke="var(--color-text-primary)" strokeWidth="1.2" />
        <circle cx="0" cy="0" r="1.4" fill="var(--color-accent-data)" />
      </svg>
    </div>
  );
};

const AttitudeIndicator = memo(AttitudeIndicatorComponent);
AttitudeIndicator.displayName = 'AttitudeIndicator';
export default AttitudeIndicator;
