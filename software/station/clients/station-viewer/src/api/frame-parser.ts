import Long from 'long';
import { yahboom_dogzilla_lite, drivers, inference, motors_mirroring, normvla, st3215, sysinfo, usbvideo } from '@/api/proto.js';
import { NormFsClient } from "./normfs.js";
import { getGlobalTimeAdjustmentNs, isTimeSyncActive } from '@/api/time-sync.js';
import {
  createLiveCameraMetadataEnvelope,
  publishLiveCameraFrame,
} from '@/usbvideo/live-camera-store';

export interface FrameEntry<T> {
  queueId: string;
  ptr: Uint8Array;
  data: T;
  rawData?: Uint8Array | null;
  queueType: drivers.QueueDataType;
}

export interface Frame {
  stateId?: Uint8Array;
  st3215?: FrameEntry<st3215.IInferenceState>;
  st3215Tx?: FrameEntry<st3215.ITxEnvelope>;
  videoQueues?: FrameEntry<usbvideo.IRxEnvelope>[];
  mirroring?: FrameEntry<motors_mirroring.IRxEnvelope>;
  sysinfo?: FrameEntry<sysinfo.IEnvelope>;
  yahboom_dogzilla_lite?: FrameEntry<yahboom_dogzilla_lite.IInferenceState>;
  normvla?: FrameEntry<normvla.IFrame>;

  // Other entries that weren't decoded (raw bytes with pointers)
  otherEntries?: { [queueId: string]: { ptr: Uint8Array; data: Uint8Array } };

  // Timestamps from InferenceRx
  localStampNs?: Long;
  monotonicStampNs?: Long;
  appStartId?: Long;

  timeAdjustment?: {
    isActive: boolean;
    adjustmentNs: Long;
    adjustmentNsNumber: number;
  };
}

// Find entry in previous frame with matching queue and pointer
type DecodedEntry = st3215.IInferenceState | st3215.ITxEnvelope | usbvideo.IRxEnvelope | motors_mirroring.IRxEnvelope | sysinfo.IEnvelope | yahboom_dogzilla_lite.IInferenceState | normvla.IFrame | null;

interface ParseFrameOptions {
  retainRawData?: boolean;
  publishVideoFrames?: boolean;
}

function findPreviousEntry(
  previousFrame: Frame | undefined,
  queue: string,
  ptr: Uint8Array
): { decoded: DecodedEntry; rawData: Uint8Array | null } | null {
  if (!previousFrame) return null;

  // Check st3215
  if (previousFrame.st3215?.queueId === queue) {
    const prevPtr = previousFrame.st3215.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.st3215.data, rawData: previousFrame.st3215.rawData ?? null };
    }
  }

  // Check videoQueues
  if (previousFrame.videoQueues) {
    const match = previousFrame.videoQueues.find(v => v.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check mirroring
  if (previousFrame.mirroring?.queueId === queue) {
    const prevPtr = previousFrame.mirroring.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.mirroring.data, rawData: previousFrame.mirroring.rawData ?? null };
    }
  }

  // Check sysinfo
  if (previousFrame.sysinfo?.queueId === queue) {
    const prevPtr = previousFrame.sysinfo.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.sysinfo.data, rawData: previousFrame.sysinfo.rawData ?? null };
    }
  }

  // Check yahboom_dogzilla_lite
  if (previousFrame.yahboom_dogzilla_lite?.queueId === queue) {
    const prevPtr = previousFrame.yahboom_dogzilla_lite.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.yahboom_dogzilla_lite.data, rawData: previousFrame.yahboom_dogzilla_lite.rawData ?? null };
    }
  }

  // Check normvla
  if (previousFrame.normvla?.queueId === queue) {
    const prevPtr = previousFrame.normvla.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.normvla.data, rawData: previousFrame.normvla.rawData ?? null };
    }
  }

  // Check st3215Tx
  if (previousFrame.st3215Tx?.queueId === queue) {
    const prevPtr = previousFrame.st3215Tx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.st3215Tx.data, rawData: previousFrame.st3215Tx.rawData ?? null };
    }
  }

  // Check otherEntries
  if (previousFrame.otherEntries?.[queue]) {
    const prevEntry = previousFrame.otherEntries[queue];
    const prevPtr = prevEntry.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: null, rawData: prevEntry.data };
    }
  }

  return null;
}

export async function parseFrame(
  inferenceRx: inference.IInferenceRx,
  entryIdBytes: Uint8Array,
  normFs: NormFsClient,
  previousFrame?: Frame,
  options: ParseFrameOptions = {},
): Promise<Frame> {
  const retainRawData = options.retainRawData ?? true;
  const publishVideoFrames = options.publishVideoFrames ?? false;
  const frame: Frame = {
    stateId: new Uint8Array(Array.from(entryIdBytes)),
    videoQueues: [],
    otherEntries: retainRawData ? {} : undefined
  };

  // Add timestamps from InferenceRx
  if (inferenceRx.localStampNs) {
    frame.localStampNs = Long.fromValue(inferenceRx.localStampNs);
  }
  if (inferenceRx.monotonicStampNs) {
    frame.monotonicStampNs = Long.fromValue(inferenceRx.monotonicStampNs);
  }
  if (inferenceRx.appStartId) {
    frame.appStartId = Long.fromValue(inferenceRx.appStartId);
  }

  // Add time adjustment information
  const timeSyncActive = isTimeSyncActive();
  const adjustmentNsNumber = getGlobalTimeAdjustmentNs();

  frame.timeAdjustment = {
    isActive: timeSyncActive,
    adjustmentNs: Long.fromNumber(adjustmentNsNumber),
    adjustmentNsNumber: adjustmentNsNumber,
  };

  // Read entries: reuse unchanged, fetch only changed ones in parallel
  if (inferenceRx.entries && inferenceRx.entries.length > 0) {
    const entryPromises = inferenceRx.entries.map((entry) => {
      if (!entry.queue || !entry.ptr) {
        console.warn("Entry missing queue or ptr:", entry);
        return Promise.resolve(null);
      }

      // Check if we can reuse from previous frame
      const previousEntry = findPreviousEntry(previousFrame, entry.queue, entry.ptr);
      if (previousEntry) {
        // Reuse - return immediately without fetch
        return Promise.resolve({
          queue: entry.queue,
          type: entry.type,
          ptr: entry.ptr,
          decoded: previousEntry.decoded,
          rawData: previousEntry.rawData,
          id: null,
          reused: true,
          isNormvla: entry.queue?.endsWith('/inference/normvla') ?? false
        });
      }

      // Pointer changed, fetch from StreamFS
      return (async () => {
        try {
          const streamEntry = await normFs.readSingleEntry(entry.queue!, entry.ptr!);

          // Decode based on queue data type
          let decoded = null;

          switch (entry.type) {
            case drivers.QueueDataType.QDT_ST3215_INFERENCE:
              try {
                decoded = st3215.InferenceState.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode st3215.InferenceState:", error);
              }
              break;
            case drivers.QueueDataType.QDT_USB_VIDEO_FRAMES:
              try {
                decoded = usbvideo.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode usbvideo.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_MOTOR_MIRRORING_RX:
              try {
                decoded = motors_mirroring.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode motors_mirroring.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_SYSTEM:
              try {
                decoded = sysinfo.Envelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode sysinfo.Envelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE:
              try {
                decoded = yahboom_dogzilla_lite.InferenceState.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode yahboom_dogzilla_lite.InferenceState:", error);
              }
              break;
            case drivers.QueueDataType.QDT_ST3215_SERIAL_TX:
              try {
                decoded = st3215.TxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode st3215.TxEnvelope:", error);
              }
              break;
            default:
              if (entry.queue?.endsWith('/inference/normvla')) {
                try {
                  decoded = normvla.Frame.decode(streamEntry.data);
                } catch (error) {
                  console.error("Failed to decode normvla.Frame:", error);
                }
              }
              break;
          }

          return {
            queue: entry.queue,
            type: entry.type,
            ptr: entry.ptr,
            decoded,
            rawData: streamEntry.data,
            id: streamEntry.id,
            reused: false,
            isNormvla: entry.queue?.endsWith('/inference/normvla') ?? false
          };
        } catch (error) {
          console.error(`Failed to read entry from queue ${entry.queue}:`, error);
          return null;
        }
      })();
    });

    const results = await Promise.all(entryPromises);

    // Build Frame from results
    for (const result of results) {
      if (!result || !result.queue || !result.ptr) continue;

      if (result.decoded) {
        switch (result.type) {
          case drivers.QueueDataType.QDT_ST3215_INFERENCE:
            frame.st3215 = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as st3215.IInferenceState,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_USB_VIDEO_FRAMES:
            if (publishVideoFrames) {
              publishLiveCameraFrame(result.queue, result.decoded as usbvideo.IRxEnvelope);
            }
            frame.videoQueues!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: publishVideoFrames
                ? createLiveCameraMetadataEnvelope(result.decoded as usbvideo.IRxEnvelope)
                : result.decoded as usbvideo.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          case drivers.QueueDataType.QDT_MOTOR_MIRRORING_RX:
            frame.mirroring = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as motors_mirroring.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_SYSTEM:
            frame.sysinfo = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as sysinfo.IEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE:
            frame.yahboom_dogzilla_lite = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as yahboom_dogzilla_lite.IInferenceState,
              rawData: result.rawData ?? null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_ST3215_SERIAL_TX:
            frame.st3215Tx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as st3215.ITxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
        }
        if (result.isNormvla && result.decoded) {
          frame.normvla = {
            queueId: result.queue,
            ptr: result.ptr,
            data: result.decoded as normvla.IFrame,
            rawData: retainRawData ? result.rawData ?? null : null,
            queueType: result.type ?? drivers.QueueDataType.QDT_SYSTEM
          };
        }
      } else if (retainRawData && result.rawData) {
        // Store unknown entries as raw bytes with pointers
        frame.otherEntries![result.queue] = {
          ptr: result.ptr,
          data: result.rawData
        };
      }
    }
  }

  return frame;
}
