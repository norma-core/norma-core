import type { yahboom_dogzilla_lite } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/codec';
import { defineHistory } from '@/devices/history';
import { yahboomDogzillaLiteCodec } from './codec';

function Summary({ entry }: { entry: FrameEntry<yahboom_dogzilla_lite.IInferenceState> }) {
  const devices = entry.data.devices ?? [];
  const connected = devices.filter((device) => device.isConnected).length;
  return (
    <div className="text-xs text-accent-data">
      Devices: {devices.length}
      {connected > 0 && <span className="ml-2 text-accent-success">({connected} connected)</span>}
    </div>
  );
}

export default defineHistory({
  codec: yahboomDogzillaLiteCodec,
  order: 12,
  Summary,
  loadExpanded: () => import('./ui/YahboomDogzillaLiteHistoryView'),
});
