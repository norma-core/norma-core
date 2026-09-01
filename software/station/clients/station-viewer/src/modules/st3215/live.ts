import {
  LIVE_TRAIT_REALTIME,
  customLive,
  frameFieldClaims,
} from '@/live/define-live-module';
import type { BusViewerProps } from '@/modules/st3215/BusViewer';

export default customLive<BusViewerProps>({
  label: 'ST3215',
  order: 10,
  claims: frameFieldClaims('st3215', 'mirroring'),
  traits: [LIVE_TRAIT_REALTIME],
  select: (frame) => {
    const inferenceState = frame.st3215?.data;
    if (!inferenceState?.buses?.length) {
      return [];
    }

    return [{
      key: 'st3215',
      props: {
        inferenceState,
        mirroringState: frame.mirroring?.data.state ?? undefined,
      },
    }];
  },
  loadView: () => import('@/modules/st3215/BusViewer'),
});
