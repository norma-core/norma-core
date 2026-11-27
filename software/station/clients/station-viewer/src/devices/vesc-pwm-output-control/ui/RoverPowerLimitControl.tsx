import { useId } from 'react';
import { ROVER_MAX_RPM_LIMIT, ROVER_MIN_DRIVE_RPM } from '../control-input';
interface RoverPowerLimitControlProps {
  value: number;
  onChange: (value: number) => void;
  expanded: boolean;
  onToggle: () => void;
}
export default function RoverPowerLimitControl({ value, onChange, expanded, onToggle }: RoverPowerLimitControlProps) {
  const id = useId();
  return <section className={`rover-limit rover-panel ${expanded ? 'expanded' : ''}`} aria-label="Maximum RPM">
    <button type="button" className="rover-setting-toggle" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
      <span>Max RPM</span><output>{value}</output><span aria-hidden>⌄</span>
    </button>
    <div className="rover-setting-content" id={id}>
      <div className="rover-panel-heading"><label htmlFor={`${id}-range`}>Max RPM</label><output>{value}</output></div>
      <input id={`${id}-range`} aria-label="Maximum RPM" aria-valuetext={`${value} RPM requested`} type="range" min={ROVER_MIN_DRIVE_RPM} max={ROVER_MAX_RPM_LIMIT} step={50}
        value={value} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
      <div className="rover-rpm-scale"><span>{ROVER_MIN_DRIVE_RPM.toLocaleString()}</span><span>{ROVER_MAX_RPM_LIMIT.toLocaleString()}</span></div>
    </div>
  </section>;
}
