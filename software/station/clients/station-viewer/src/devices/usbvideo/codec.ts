import { drivers, usbvideo } from '@/api/proto.js';
import { defineCodec } from '@/devices/codec';
import {
  createLiveCameraMetadataEnvelope,
  publishLiveCameraFrame,
} from '@/usbvideo/live-camera-store';

const metadataEnvelopes = new WeakSet<object>();

export const usbVideoCodec = defineCodec<usbvideo.IRxEnvelope>({
  key: 'usbvideo',
  message: usbvideo.RxEnvelope,
  queueType: drivers.QueueDataType.QDT_USB_VIDEO_FRAMES,
  cardinality: 'multiple',
  afterDecode: (decoded, context) => {
    if (!context.shouldPublishVideoFrames()) {
      return decoded;
    }
    publishLiveCameraFrame(context.queueId, decoded);
    const metadata = createLiveCameraMetadataEnvelope(decoded);
    metadataEnvelopes.add(metadata);
    return metadata;
  },
  reusable: (previous, context) => {
    const wantsMetadata = context.shouldPublishVideoFrames();
    const isMetadata = metadataEnvelopes.has(previous.data);
    return wantsMetadata ? isMetadata : !isMetadata;
  },
});

export default usbVideoCodec;
