import { customLive } from '@/devices/live';
import type { Frame, FrameEntry } from '@/api/frame-parser';
import type { dfrobot_light_rs485 } from '@/api/proto.js';

export interface DfrobotLightRs485LiveViewProps {
  entries: FrameEntry<dfrobot_light_rs485.IRxEnvelope>[];
}

export default customLive<DfrobotLightRs485LiveViewProps>({
  id: 'dfrobot-light-rs485',
  label: 'DFRobot RS485',
  order: 5,
  slot: 'summary',
  loadView: () => import('./ui/DfrobotLightRs485LiveView'),
  select: (frame: Frame) =>
    frame.dfrobotLightRs485 && frame.dfrobotLightRs485.length > 0
      ? [{ key: 'dfrobot-light-rs485', props: { entries: frame.dfrobotLightRs485 } }]
      : [],
});
