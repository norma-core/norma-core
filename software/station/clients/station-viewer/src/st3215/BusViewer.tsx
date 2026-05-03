import { memo } from "react";
import { st3215, usbvideo, motors_mirroring, ov5647 } from "../api/proto";
import BusCard from "./BusCard";

import { FrameEntry } from "../api/frame-parser";

interface BusViewerProps {
  inferenceState: st3215.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
  mirroringState?: motors_mirroring.IInferenceState;
}

const BusViewer = memo(function BusViewer({ inferenceState, videoSources, ov5647Sources, mirroringState }: BusViewerProps) {
  if (!inferenceState.buses) {
    return <div>No bus data available.</div>;
  }

  return (
    <div className="font-mono text-accent-success">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {inferenceState.buses.map((bus, busIndex) => {
          const busKey = bus.bus?.serialNumber
            || bus.bus?.portName
            || `${bus.bus?.vid ?? 'unknown'}:${bus.bus?.pid ?? 'unknown'}:${bus.bus?.portBaudRate ?? 'unknown'}`;

          return (
            <BusCard
              key={busKey}
              bus={bus}
              busIndex={busIndex}
              videoSources={videoSources}
              ov5647Sources={ov5647Sources}
              allBuses={inferenceState.buses}
              mirroringState={mirroringState}
            />
          );
        })}
      </div>
    </div>
  );
});

export default BusViewer;
