import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Long from 'long';
import type { FrameEntry } from '@/api/frame-parser';
import { serverToLocal } from '@/api/timestamp-utils';
import type { arduino_nicla_sense_me, usbvideo, vesc_trampa, victron_smartsolar_mppt } from '@/api/proto.js';
import { useConnectionStats, useElementFullscreen } from '@/hooks';
import { parseVescTrampaValuesPayload } from '@/devices/vesc-trampa/values-parser';
import { formatVescTrampaUuid, shortVescTrampaUuid } from '@/devices/vesc-trampa/utils';
import { useRoverControlSession } from '../useRoverControlSession';
import { readRoverPower } from '../rover-power';
import { readRoverMotion } from '../rover-motion';
import RoverCameraViewport from './RoverCameraViewport';
import RoverDriveControls from './RoverDriveControls';
import RoverPowerLimitControl from './RoverPowerLimitControl';
import RoverCameraServoControl from './RoverCameraServoControl';
// eslint-disable-next-line import/no-unassigned-import -- device-scoped stylesheet
import './rover.css';

const EMPTY_UUID = new Uint8Array();
const powerFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero', useGrouping: false });
export interface VescPwmOutputControlPanelProps {
  vesc: vesc_trampa.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  powerSource?: FrameEntry<victron_smartsolar_mppt.IRxEnvelope>;
  motionSource?: FrameEntry<arduino_nicla_sense_me.IRxEnvelope>;
}
const VescPwmOutputControlPanel = memo(function VescPwmOutputControlPanel({ vesc, videoSources = [], motionSource, powerSource }: VescPwmOutputControlPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(rootRef);
  const connection = useConnectionStats();
  const [boardKey, setBoardKey] = useState('');
  const [expanded, setExpanded] = useState<'camera' | 'rpm' | null>(null);
  const [now, setNow] = useState(Date.now);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const boards = vesc.boards?.filter(b => b.board?.uuid?.length) ?? [];
  const board = boards.find(b => formatVescTrampaUuid(b.board!.uuid!) === boardKey) ?? boards[0];
  const uuid = board?.board?.uuid ?? EMPTY_UUID;
  const valuesResult = useMemo(() => parseVescTrampaValuesPayload(board?.valuesPayload), [board?.valuesPayload]);
  const values = valuesResult.values;
  const age = board?.valuesMonotonicStampNs ? now - serverToLocal(Long.fromValue(board.valuesMonotonicStampNs)).toNumber() / 1e6 : Infinity;
  const online = connection.status === 'connected' && connection.acquisitionMode === 'live';
  const fault = !!valuesResult.error || !!values?.faultCode;
  const ready = online && !!values && age >= -1000 && age < 5000 && !fault;
  const session = useRoverControlSession({ boardUuid: uuid, steeringOutputId: 'steering', suspended: !ready || expanded !== null });
  const motion = useMemo(() => online ? readRoverMotion(motionSource?.data, now) : null, [online, motionSource?.data, now]);
  const power = useMemo(() => online ? readRoverPower(powerSource?.data, now) : null, [online, powerSource?.data, now]);
  const powerText = power ? `${powerFormat.format(power.watts)} W` : '— W';
  const powerDirection = power ? (power.watts > 0 ? 'charging' : power.watts < 0 ? 'discharging' : 'idle') : 'unavailable';
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const resize = () => {
      const top = isFullscreen ? 0 : (rootRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      setAvailableHeight(Math.max(180, (window.visualViewport?.height ?? window.innerHeight) - top));
    };
    resize(); window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    if (rootRef.current?.parentElement) observer.observe(rootRef.current.parentElement);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); };
  }, [isFullscreen]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (e: PointerEvent) => { if (!(e.target as Element)?.closest('.rover-camera,.rover-limit')) setExpanded(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, [expanded]);
  function toggle(which: 'camera' | 'rpm') { session.actions.stop(); setExpanded(current => current === which ? null : which); }
  return <section ref={rootRef} className="rover-cockpit" aria-label="Rover control" style={{ height: availableHeight, '--rover-height': availableHeight ? `${availableHeight}px` : undefined } as CSSProperties}>
    <div className="rover-statusbar">
      <span className="rover-name">ROVER</span>
      {boards.length > 1 && <select aria-label="Drive board" value={formatVescTrampaUuid(uuid)} onChange={event => { session.actions.stop(); setBoardKey(event.target.value); }}>
        {boards.map(b => <option key={formatVescTrampaUuid(b.board!.uuid!)} value={formatVescTrampaUuid(b.board!.uuid!)}>{shortVescTrampaUuid(b.board!.uuid!)}</option>)}
      </select>}
      <span className={`rover-health ${ready ? 'ready' : 'unavailable'}`} role="status"><i />{!online ? 'Offline' : fault ? 'Drive fault' : !ready ? 'Waiting for drive' : 'Connected'}</span>
      <span className="rover-battery" data-flow={powerDirection}
        aria-label={`Battery ${powerDirection}: ${powerText}`}
        title={power ? `Victron battery balance: + charging / − draining · ${power.voltage.toFixed(2)} V × ${power.current.toFixed(3)} A` : 'Waiting for fresh Victron battery data'}>{powerText}</span>
    </div>
    <div className={`rover-workspace ${expanded === 'rpm' ? 'rpm-expanded' : ''}`}>
      <RoverCameraViewport source={videoSources[0]} motion={motion} now={now} disabled={!online} isFullscreen={isFullscreen} onToggleFullscreen={() => void toggleFullscreen()} onBeforeChange={session.actions.stop} />
      <aside className="rover-control-rail" aria-label="Rover controls">
        <RoverDriveControls session={session} />
        <div className="rover-settings">
          <RoverCameraServoControl disabled={!online || session.state.active} expanded={expanded === 'camera'} onToggle={() => toggle('camera')} />
          <RoverPowerLimitControl value={session.state.rpmLimit} onChange={session.actions.setRpmLimit} expanded={expanded === 'rpm'} onToggle={() => toggle('rpm')} />
        </div>
      </aside>
    </div>
  </section>;
});
export default VescPwmOutputControlPanel;
