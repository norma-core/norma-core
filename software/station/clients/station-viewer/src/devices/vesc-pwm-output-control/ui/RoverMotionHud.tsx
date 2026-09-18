import { memo, useId, useMemo } from 'react';
import type { RoverMotion } from '../rover-motion';
import { renderRoverModel } from './rover-model';
interface RoverMotionHudProps { motion: RoverMotion | null }
const cardinals = ['N','NE','E','SE','S','SW','W','NW'];
const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}°`;
const RoverMotionHud = memo(function RoverMotionHud({ motion }: RoverMotionHudProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svg = useMemo(() => motion ? renderRoverModel(motion, id) : '', [motion, id]);
  const heading = motion?.heading ?? null;
  // Hub-estimated heading error. While the magnetometer is uncalibrated the
  // hub reports ~180° and readRoverMotion withholds the heading entirely.
  // The hub reports quantized levels: a calibrated magnetometer settles at
  // 25–30° on this board (the firmware saves its profile below ~35°), ~59°
  // early in calibration, 180° uncalibrated; the tiers follow those levels.
  const accuracy = motion?.headingAccuracyDeg ?? null;
  const uncalibrated = motion?.headingUncalibrated ?? false;
  const accuracyLevel = accuracy === null ? null : accuracy < 35 ? 'good' : accuracy < 70 ? 'fair' : 'poor';
  const accuracyLabel = uncalibrated ? 'CALIBRATING' : accuracy === null || heading === null ? null : `±${Math.round(accuracy)}°`;
  const ticks = [];
  if (heading !== null) for (let bearing = Math.floor((heading - 75) / 15) * 15; bearing <= heading + 75; bearing += 15) {
    const normal = ((bearing % 360) + 360) % 360;
    ticks.push(<span key={bearing} className={normal % 45 === 0 ? 'cardinal' : ''} style={{ left: `${50 + (bearing-heading)/1.5}%` }}>
      {normal % 45 === 0 ? cardinals[normal/45] : normal}
    </span>);
  }
  return <>
    <div className="rover-compass" role="img" title="Magnetic heading · ± is the sensor hub's heading error estimate" aria-label={heading !== null ? `Rover magnetic heading ${Math.round(heading) % 360} degrees${accuracy !== null ? `, plus or minus ${Math.round(accuracy)} degrees` : ''}` : uncalibrated ? 'Heading unavailable, magnetometer calibrating' : 'Heading unavailable'}>
      <div className="rover-compass-tape" aria-hidden>{ticks}</div>
      {heading !== null && <span className="rover-compass-pointer" aria-hidden />}
      <output>{heading !== null ? `${String(Math.round(heading)%360).padStart(3,'0')}° ${cardinals[Math.round(heading/45)%8]}` : 'NO HEADING'}</output>
      {accuracyLabel !== null && <span className="rover-compass-accuracy" data-level={accuracyLevel}>{accuracyLabel}</span>}
    </div>
    <div className="rover-motion-model" title="Chassis attitude · X forward, Y left, Z up">
      {motion ? <>
        <svg viewBox="24 -4 186 126" role="img" aria-label={`Rear view of rover: pitch ${signed(motion.pitch)}, roll ${signed(motion.roll)}; linear acceleration without gravity and gyro vectors`} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="rover-motion-readings">
          <div><span>Pitch <output>{signed(motion.pitch)}</output></span><span>Roll <output>{signed(motion.roll)}</output></span></div>
          <div><span className="accel" title="Linear acceleration · gravity removed">Acc <output>{Math.hypot(motion.accel.x,motion.accel.y,motion.accel.z).toFixed(2)} g</output></span><span className="gyro">Gyro <output>{Math.hypot(motion.gyro.x,motion.gyro.y,motion.gyro.z).toFixed(1)}°/s</output></span></div>
        </div>
      </> : <span className="rover-no-motion">Motion unavailable</span>}
    </div>
  </>;
});
export default RoverMotionHud;
