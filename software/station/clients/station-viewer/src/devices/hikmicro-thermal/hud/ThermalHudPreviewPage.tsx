import { useEffect, useState } from 'react';
import type { hikmicro } from '@/api/proto.js';
import HikmicroThermalLiveView from '../ui/HikmicroThermalLiveView';
import { createThermalDemo } from './demo';

/** Review fixture: the actual station widget and its native fullscreen flow. */
function ThermalHudPreviewPage() {
  const [data, setData] = useState<hikmicro.IRxEnvelope>({});
  useEffect(() => {
    const generate = createThermalDemo();
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => setData({ ...generate(performance.now()), deviceInfo: { usb: { product: 'HIKMICRO · SYNTHETIC DEMO' } } });
    const sync = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return;
      tick();
      timer = setInterval(tick, 40);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return <main className="min-h-screen bg-surface-base text-text-primary flex flex-col items-center justify-center gap-5 p-6">
    <p className="text-sm text-text-muted">Synthetic preview · open fullscreen to see the video HUD.</p>
    <HikmicroThermalLiveView data={data} demo />
  </main>;
}
export default ThermalHudPreviewPage;
