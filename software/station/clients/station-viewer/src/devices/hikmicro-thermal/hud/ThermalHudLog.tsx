import { useEffect, useRef, useState } from 'react';
import type { hikmicro } from '@/api/proto.js';
import { ThermalMachineLog, type MachineLogSnapshot, type MachineLogStats } from './machine-log';

interface ThermalHudLogProps { frame: hikmicro.IThermalFrame | null; stats: MachineLogStats; }

function ThermalHudLog({ frame, stats }: ThermalHudLogProps) {
  const logRef = useRef<ThermalMachineLog | null>(null);
  const [snapshot, setSnapshot] = useState<MachineLogSnapshot>({ receivedFrames: 0, lines: [], rawLines: [] });
  useEffect(() => {
    logRef.current ??= new ThermalMachineLog();
    if (document.visibilityState !== 'hidden') logRef.current.observe(frame, stats);
  }, [frame, stats]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const publish = () => {
      const next = logRef.current?.flush();
      if (next) setSnapshot(next);
    };
    const sync = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return;
      publish();
      timer = setInterval(publish, 250);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return <><div className="thermal-mirror__machine" aria-label="Thermal machine log" aria-live="off">
    <div className="thermal-mirror__machine-heading"><span>DATA PROCESSING</span><span>RX {String(snapshot.receivedFrames).padStart(6, '0')}</span></div>
    <div className="thermal-mirror__machine-lines">
      {snapshot.lines.map(line => <div key={line.id} className="thermal-mirror__machine-row"><span>{String(line.id).padStart(4, '0')}</span><span>{line.text}</span></div>)}
    </div>
    <span className="thermal-mirror__machine-cursor" aria-hidden="true">▍</span>
  </div>
    <div className="thermal-mirror__raw-stream" aria-label="Native Y16 memory samples" aria-live="off">
      <div className="thermal-mirror__machine-heading"><span>Y16 / MEMORY SCAN</span><span>HEX</span></div>
      <div className="thermal-mirror__raw-lines">{snapshot.rawLines.map(line => <div key={line.id} className="thermal-mirror__machine-row">{line.text}</div>)}</div>
      <div className="thermal-mirror__raw-footer">LITTLE ENDIAN / 16 BIT</div>
    </div>
  </>;
}
export default ThermalHudLog;
