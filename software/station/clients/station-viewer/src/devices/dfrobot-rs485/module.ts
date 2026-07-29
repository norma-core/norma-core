import { customLive } from '@/devices/live';
import type { Frame, FrameEntry } from '@/api/frame-parser';
import type { dfrobot_rs485 } from '@/api/proto.js';

export interface DfrobotRs485LiveViewProps {
  entries: FrameEntry<dfrobot_rs485.IRxEnvelope>[];
}

export default customLive<DfrobotRs485LiveViewProps>({
  id: 'dfrobot-rs485',
  label: 'DFRobot RS485',
  order: 5,
  slot: 'summary',
  loadView: () => import('./ui/DfrobotRs485LiveView'),
  select: (frame: Frame) =>
    frame.dfrobotRs485 && frame.dfrobotRs485.length > 0
      ? [{ key: 'dfrobot-rs485', props: { entries: frame.dfrobotRs485 } }]
      : [],
});
