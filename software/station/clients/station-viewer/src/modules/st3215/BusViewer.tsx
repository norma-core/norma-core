import { memo } from "react";
import { st3215, usbvideo, motors_mirroring } from '@/api/proto';
import BusCard from "./BusCard";

import type { FrameEntry } from '@/api/frame-parser';

export interface BusViewerProps {
  inferenceState: st3215.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  mirroringState?: motors_mirroring.IInferenceState;
}

const BusViewer = memo(function BusViewer({ inferenceState, videoSources, mirroringState }: BusViewerProps) {
  if (!inferenceState.buses) {
    return <div>No bus data available.</div>;
  }

  return (
    <div className="w-full font-mono text-accent-success">
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
        {inferenceState.buses.map((bus, busIndex) => (
          <BusCard
            key={busIndex}
            bus={bus}
            busIndex={busIndex}
            videoSources={videoSources}
            allBuses={inferenceState.buses}
            mirroringState={mirroringState}
          />
        ))}
      </div>
    </div>
  );
});

export default BusViewer;
