import type { FrameEntry } from '@/api/frame-parser';
import type { motors_mirroring, st3215, usbvideo } from '@/api/proto.js';
import BusViewer from '@/st3215/BusViewer';

export interface St3215LiveViewProps {
  inferenceState: st3215.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  mirroringState?: motors_mirroring.IInferenceState;
}

export default function St3215LiveView(props: St3215LiveViewProps) {
  return <BusViewer {...props} />;
}
