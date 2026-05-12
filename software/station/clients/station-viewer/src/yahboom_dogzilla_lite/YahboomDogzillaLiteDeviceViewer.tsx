import { memo } from 'react';
import type { FrameEntry } from '@/api/frame-parser';
import { yahboom_dogzilla_lite, ov5647, usbvideo } from '@/api/proto.js';
import YahboomDogzillaLiteCard from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteCard';

interface YahboomDogzillaLiteDeviceViewerProps {
  inferenceState: yahboom_dogzilla_lite.IInferenceState;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
}

const YahboomDogzillaLiteDeviceViewer = memo(function YahboomDogzillaLiteDeviceViewer({
  inferenceState,
  videoSources,
  ov5647Sources
}: YahboomDogzillaLiteDeviceViewerProps) {
  const devices = inferenceState.devices ?? [];

  if (devices.length === 0) {
    return null;
  }

  return (
    <>
      {devices.map((deviceState, deviceIndex) => (
        <YahboomDogzillaLiteCard
          key={`yahboom_dogzilla_lite-${deviceState.device?.serialNumber || deviceState.device?.portName || deviceState.device?.firmwareVersion || deviceState.device?.model || 'unknown'}`}
          deviceState={deviceState}
          deviceIndex={deviceIndex}
          videoSources={videoSources}
          ov5647Sources={ov5647Sources}
        />
      ))}
    </>
  );
});

export default YahboomDogzillaLiteDeviceViewer;
