import type { motors_mirroring } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/codec';
import { defineHistory } from '@/devices/history';
import { mirroringCodec } from './codec';

function Summary({ entry }: { entry: FrameEntry<motors_mirroring.IRxEnvelope> }) {
  const count = entry.data.state?.mirroring?.length ?? 0;
  return count > 0 ? <div className="text-xs text-accent-secondary">Mirroring: {count} configs</div> : null;
}

export default defineHistory({
  codec: mirroringCodec,
  order: 6,
  Summary,
  loadExpanded: () => import('./ui/MirroringHistoryView'),
});
