import { memo } from 'react';
import type { FrameEntry } from '@/api/frame-parser';
import { dogzilla, ov5647, usbvideo } from '@/api/proto.js';
import DogzillaCard from '@/dogzilla/DogzillaCard';

interface DogzillaDeviceViewerProps {
  inferenceState: dogzilla.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
}

const DogzillaDeviceViewer = memo(function DogzillaDeviceViewer({
  inferenceState,
  videoSources,
  ov5647Sources
}: DogzillaDeviceViewerProps) {
  const devices = inferenceState.devices ?? [];

  if (devices.length === 0) {
    return null;
  }

  return (
    <>
      {devices.map((deviceState, deviceIndex) => (
        <DogzillaCard
          key={`dogzilla-${deviceState.device?.serialNumber || deviceState.device?.portName || deviceState.device?.firmwareVersion || deviceState.device?.model || 'unknown'}`}
          deviceState={deviceState}
          deviceIndex={deviceIndex}
          videoSources={videoSources}
          ov5647Sources={ov5647Sources}
        />
      ))}
    </>
  );
});

export default DogzillaDeviceViewer;
