import React, { useEffect, useState } from 'react';
import UsbVideoTimelineTrack from './UsbVideoTimelineTrack';
import { inference, usbvideo } from '@/api/proto';
import webSocketManager from '@/api/websocket';
import Long from 'long';

const INFERENCE_STATES_QUEUE = "inference-states";

interface UsbVideoTimelineProps {
  queueId: string;
  currentFrame: number;
  minFrame: number;
  maxFrame: number;
  isFirst?: boolean;
  isLast?: boolean;
}

const UsbVideoTimeline: React.FC<UsbVideoTimelineProps> = (props) => {
  const [disabledBeforeFrame, setDisabledBeforeFrame] = useState<number | undefined>(undefined);
  const [queueFirstId, setQueueFirstId] = useState<Uint8Array | null>(null);
  const [queueLastId, setQueueLastId] = useState<Uint8Array | null>(null);

  useEffect(() => {
    const fetchVideoQueueBounds = async () => {
      try {
        const firstVideoId = new Uint8Array([0]); // First ID is always 0
        const firstEntry = await webSocketManager.normFs.readSingleEntry(props.queueId, firstVideoId);
        if (firstEntry.data) {
          const decoded = usbvideo.RxEnvelope.decode(firstEntry.data);
          if (decoded.lastInferenceQueuePtr) {
            const frame = Long.fromBytesLE(Array.from(decoded.lastInferenceQueuePtr)).toNumber();
            setDisabledBeforeFrame(frame);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch first frame for ${props.queueId}:`, error);
      }
    };
    fetchVideoQueueBounds();
  }, [props.queueId]);

  useEffect(() => {
    const fetchPointersForRange = async () => {
      if (props.minFrame >= props.maxFrame) {
        setQueueFirstId(null);
        setQueueLastId(null);
        return;
      }
      try {
        // 1. Get the inference state for the minFrame
        const minFrameIdBytes = new Uint8Array(Long.fromNumber(props.minFrame).toBytesLE());
        const minEntryData = await webSocketManager.normFs.readSingleEntry(INFERENCE_STATES_QUEUE, minFrameIdBytes);
        let firstId: Uint8Array | null = null;
        if (minEntryData.data) {
          const minInferenceRx = inference.InferenceRx.decode(minEntryData.data);
          const usbVideoEntry = minInferenceRx.entries?.find(e => e.queue === props.queueId);
          if (usbVideoEntry?.ptr) {
            firstId = usbVideoEntry.ptr;
          }
        }
        setQueueFirstId(firstId);

        // 2. Get the inference state for the maxFrame
        const maxFrameIdBytes = new Uint8Array(Long.fromNumber(props.maxFrame).toBytesLE());
        const maxEntryData = await webSocketManager.normFs.readSingleEntry(INFERENCE_STATES_QUEUE, maxFrameIdBytes);
        let lastId: Uint8Array | null = null;
        if (maxEntryData.data) {
          const maxInferenceRx = inference.InferenceRx.decode(maxEntryData.data);
          const usbVideoEntry = maxInferenceRx.entries?.find(e => e.queue === props.queueId);
          if (usbVideoEntry?.ptr) {
            lastId = usbVideoEntry.ptr;
          }
        }
        setQueueLastId(lastId);

      } catch (error) {
        console.error(`Failed to fetch pointers for ${props.queueId}:`, error);
        setQueueFirstId(null);
        setQueueLastId(null);
      }
    };

    fetchPointersForRange();
  }, [props.queueId, props.minFrame, props.maxFrame]);
  
  return (
    <UsbVideoTimelineTrack
      {...props}
      disabledBeforeFrame={disabledBeforeFrame}
      queueFirstId={queueFirstId}
      queueLastId={queueLastId}
    />
  );
};

export default UsbVideoTimeline;
