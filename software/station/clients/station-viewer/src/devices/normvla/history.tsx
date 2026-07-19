import type { normvla } from '@/api/proto.js';
import type { FrameEntry } from '@/devices/codec';
import { defineHistory } from '@/devices/history';
import { normvlaCodec } from './codec';

function Summary({ entry }: { entry: FrameEntry<normvla.IFrame> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {entry.data.joints?.length ? <span className="text-accent-danger">Joints: {entry.data.joints.length}</span> : null}
      {entry.data.images?.length ? <span className="text-accent-data">Images: {entry.data.images.length}</span> : null}
    </div>
  );
}

export default defineHistory({
  codec: normvlaCodec,
  order: 13,
  Summary,
  loadExpanded: () => import('./ui/NormvlaHistoryView'),
  toJson: (data) => ({
    ...normvlaCodec.message.toObject(data, { longs: String, enums: String, bytes: String, defaults: true }),
    images: data.images?.map((image, index) => ({
      monotonicStampNs: image.monotonicStampNs?.toString(),
      jpeg: `[image ${index + 1}: ${image.jpeg?.length ?? 0} bytes]`,
    })) ?? [],
  }),
});
