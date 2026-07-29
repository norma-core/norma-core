import Long from 'long';
import { airgradient_open_air_o_1pst, arduino_nicla_sense_env, dfrobot_rs485, dmesg, hikmicro, ina226, yahboom_dogzilla_lite, drivers, inference, motors_mirroring, normvla, pwm_output, st3215, sysinfo, usbvideo, vesc_trampa, victron_smartsolar_mppt } from '@/api/proto.js';
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
  vescTrampa?: FrameEntry<vesc_trampa.IInferenceState>;
  vescTrampaRx?: FrameEntry<vesc_trampa.IRxEnvelope>;
  vescTrampaTx?: FrameEntry<vesc_trampa.ITxEnvelope>;
  pwmOutputRx?: FrameEntry<pwm_output.IRxEnvelope>;
  pwmOutputTx?: FrameEntry<pwm_output.ITxEnvelope>;
  usbVideoTx?: FrameEntry<usbvideo.ITxEnvelope>;
  videoQueues?: FrameEntry<usbvideo.IRxEnvelope>[];
  hikmicroThermal?: FrameEntry<hikmicro.IRxEnvelope>[];
  mirroring?: FrameEntry<motors_mirroring.IRxEnvelope>;
  sysinfo?: FrameEntry<sysinfo.IEnvelope>;
  arduinoNiclaSenseEnv?: FrameEntry<arduino_nicla_sense_env.IRxEnvelope>;
  ina226?: FrameEntry<ina226.IRxEnvelope>[];
  dfrobotRs485?: FrameEntry<dfrobot_rs485.IRxEnvelope>[];
  airgradientOpenAir?: FrameEntry<airgradient_open_air_o_1pst.IRxEnvelope>[];
  victronSmartSolar?: FrameEntry<victron_smartsolar_mppt.IRxEnvelope>[];
  dmesg?: FrameEntry<dmesg.IRxEnvelope>;
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
type DecodedEntry = st3215.IInferenceState | st3215.ITxEnvelope | usbvideo.IRxEnvelope | usbvideo.ITxEnvelope | hikmicro.IRxEnvelope | motors_mirroring.IRxEnvelope | sysinfo.IEnvelope | arduino_nicla_sense_env.IRxEnvelope | ina226.IRxEnvelope | airgradient_open_air_o_1pst.IRxEnvelope | victron_smartsolar_mppt.IRxEnvelope | dmesg.IRxEnvelope | yahboom_dogzilla_lite.IInferenceState | normvla.IFrame | vesc_trampa.IInferenceState | vesc_trampa.IRxEnvelope | vesc_trampa.ITxEnvelope | pwm_output.IRxEnvelope | pwm_output.ITxEnvelope | dfrobot_rs485.IRxEnvelope | null;

interface ParseFrameOptions {
  retainRawData?: boolean;
  shouldPublishVideoFrames?: () => boolean;
  shouldLoadVideoFrame?: (
    queueId: string,
    previousEnvelope?: usbvideo.IRxEnvelope,
  ) => boolean;
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

  // Check HIKMICRO thermal
  if (previousFrame.hikmicroThermal) {
    const match = previousFrame.hikmicroThermal.find(entry => entry.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check vescTrampa
  if (previousFrame.vescTrampa?.queueId === queue) {
    const prevPtr = previousFrame.vescTrampa.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.vescTrampa.data, rawData: previousFrame.vescTrampa.rawData ?? null };
    }
  }

  // Check vescTrampaRx
  if (previousFrame.vescTrampaRx?.queueId === queue) {
    const prevPtr = previousFrame.vescTrampaRx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.vescTrampaRx.data, rawData: previousFrame.vescTrampaRx.rawData ?? null };
    }
  }

  // Check vescTrampaTx
  if (previousFrame.vescTrampaTx?.queueId === queue) {
    const prevPtr = previousFrame.vescTrampaTx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.vescTrampaTx.data, rawData: previousFrame.vescTrampaTx.rawData ?? null };
    }
  }

  // Check pwmOutputRx
  if (previousFrame.pwmOutputRx?.queueId === queue) {
    const prevPtr = previousFrame.pwmOutputRx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.pwmOutputRx.data, rawData: previousFrame.pwmOutputRx.rawData ?? null };
    }
  }

  // Check pwmOutputTx
  if (previousFrame.pwmOutputTx?.queueId === queue) {
    const prevPtr = previousFrame.pwmOutputTx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.pwmOutputTx.data, rawData: previousFrame.pwmOutputTx.rawData ?? null };
    }
  }

  // Check usbVideoTx
  if (previousFrame.usbVideoTx?.queueId === queue) {
    const prevPtr = previousFrame.usbVideoTx.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.usbVideoTx.data, rawData: previousFrame.usbVideoTx.rawData ?? null };
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

  // Check Arduino Nicla Sense Env
  if (previousFrame.arduinoNiclaSenseEnv?.queueId === queue) {
    const prevPtr = previousFrame.arduinoNiclaSenseEnv.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.arduinoNiclaSenseEnv.data, rawData: previousFrame.arduinoNiclaSenseEnv.rawData ?? null };
    }
  }

  // Check INA226
  if (previousFrame.ina226) {
    const match = previousFrame.ina226.find(entry => entry.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check DFRobot RS485
  if (previousFrame.dfrobotRs485) {
    const match = previousFrame.dfrobotRs485.find(entry => entry.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check AirGradient Open Air O-1PST
  if (previousFrame.airgradientOpenAir) {
    const match = previousFrame.airgradientOpenAir.find(entry => entry.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check Victron SmartSolar MPPT
  if (previousFrame.victronSmartSolar) {
    const match = previousFrame.victronSmartSolar.find(entry => entry.queueId === queue);
    if (match) {
      const prevPtr = match.ptr;
      if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
        return { decoded: match.data, rawData: match.rawData ?? null };
      }
    }
  }

  // Check dmesg
  if (previousFrame.dmesg?.queueId === queue) {
    const prevPtr = previousFrame.dmesg.ptr;
    if (prevPtr.length === ptr.length && prevPtr.every((b, i) => b === ptr[i])) {
      return { decoded: previousFrame.dmesg.data, rawData: previousFrame.dmesg.rawData ?? null };
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
  const frame: Frame = {
    stateId: new Uint8Array(Array.from(entryIdBytes)),
    videoQueues: [],
    hikmicroThermal: [],
    ina226: [],
    dfrobotRs485: [],
    airgradientOpenAir: [],
    victronSmartSolar: [],
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

      const previousVideoEntry = entry.type === drivers.QueueDataType.QDT_USB_VIDEO_FRAMES
        ? previousFrame?.videoQueues?.find((videoEntry) => videoEntry.queueId === entry.queue)
        : undefined;
      if (
        previousVideoEntry
        && options.shouldLoadVideoFrame
        && !options.shouldLoadVideoFrame(entry.queue, previousVideoEntry.data)
      ) {
        // Keep the camera in the known source list while avoiding the
        // StreamFS read and video-envelope decode for an unobserved camera.
        return Promise.resolve({
          queue: entry.queue,
          type: entry.type,
          ptr: entry.ptr,
          decoded: previousVideoEntry.data,
          rawData: null,
          id: null,
          reused: true,
          isNormvla: false,
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
            case drivers.QueueDataType.QDT_USB_VIDEO_TX:
              try {
                decoded = usbvideo.TxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode usbvideo.TxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_HIKMICRO_THERMAL:
              try {
                decoded = hikmicro.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode hikmicro.RxEnvelope:", error);
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
            case drivers.QueueDataType.QDT_ARDUINO_NICLA_SENSE_ENV_RX:
              try {
                decoded = arduino_nicla_sense_env.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode arduino_nicla_sense_env.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_INA226_RX:
              try {
                decoded = ina226.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode ina226.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_DFROBOT_RS485_RX:
              try {
                decoded = dfrobot_rs485.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode dfrobot_rs485.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_AIRGRADIENT_OPEN_AIR_O_1PST_RX:
              try {
                decoded = airgradient_open_air_o_1pst.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode airgradient_open_air_o_1pst.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_VICTRON_SMARTSOLAR_MPPT_RX:
              try {
                decoded = victron_smartsolar_mppt.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode victron_smartsolar_mppt.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_DMESG_RX:
              try {
                decoded = dmesg.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode dmesg.RxEnvelope:", error);
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
            case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_RX:
              try {
                decoded = vesc_trampa.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode vesc_trampa.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_VESC_TRAMPA_INFERENCE:
              try {
                decoded = vesc_trampa.InferenceState.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode vesc_trampa.InferenceState:", error);
              }
              break;
            case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_TX:
              try {
                decoded = vesc_trampa.TxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode vesc_trampa.TxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_PWM_OUTPUT_RX:
              try {
                decoded = pwm_output.RxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode pwm_output.RxEnvelope:", error);
              }
              break;
            case drivers.QueueDataType.QDT_PWM_OUTPUT_TX:
              try {
                decoded = pwm_output.TxEnvelope.decode(streamEntry.data);
              } catch (error) {
                console.error("Failed to decode pwm_output.TxEnvelope:", error);
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
          case drivers.QueueDataType.QDT_USB_VIDEO_FRAMES: {
            const publishCurrentVideoFrame = options.shouldPublishVideoFrames?.() ?? false;
            if (publishCurrentVideoFrame) {
              publishLiveCameraFrame(result.queue, result.decoded as usbvideo.IRxEnvelope);
            }
            frame.videoQueues!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: publishCurrentVideoFrame
                ? createLiveCameraMetadataEnvelope(result.decoded as usbvideo.IRxEnvelope)
                : result.decoded as usbvideo.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          }
          case drivers.QueueDataType.QDT_HIKMICRO_THERMAL:
            frame.hikmicroThermal!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as hikmicro.IRxEnvelope,
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
          case drivers.QueueDataType.QDT_ARDUINO_NICLA_SENSE_ENV_RX:
            frame.arduinoNiclaSenseEnv = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as arduino_nicla_sense_env.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_INA226_RX:
            frame.ina226!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as ina226.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          case drivers.QueueDataType.QDT_DFROBOT_RS485_RX:
            frame.dfrobotRs485!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as dfrobot_rs485.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          case drivers.QueueDataType.QDT_AIRGRADIENT_OPEN_AIR_O_1PST_RX:
            frame.airgradientOpenAir!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as airgradient_open_air_o_1pst.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          case drivers.QueueDataType.QDT_VICTRON_SMARTSOLAR_MPPT_RX:
            frame.victronSmartSolar!.push({
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as victron_smartsolar_mppt.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            });
            break;
          case drivers.QueueDataType.QDT_DMESG_RX:
            frame.dmesg = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as dmesg.IRxEnvelope,
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
          case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_RX:
            frame.vescTrampaRx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as vesc_trampa.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_VESC_TRAMPA_INFERENCE:
            frame.vescTrampa = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as vesc_trampa.IInferenceState,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_TX:
            frame.vescTrampaTx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as vesc_trampa.ITxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_PWM_OUTPUT_RX:
            frame.pwmOutputRx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as pwm_output.IRxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_PWM_OUTPUT_TX:
            frame.pwmOutputTx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as pwm_output.ITxEnvelope,
              rawData: retainRawData ? result.rawData ?? null : null,
              queueType: result.type
            };
            break;
          case drivers.QueueDataType.QDT_USB_VIDEO_TX:
            frame.usbVideoTx = {
              queueId: result.queue,
              ptr: result.ptr,
              data: result.decoded as usbvideo.ITxEnvelope,
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
