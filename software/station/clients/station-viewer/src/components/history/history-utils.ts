import { usbvideo, frame, st3215, motors_mirroring, sysinfo, yahboom_dogzilla_lite, normvla } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';

type ParsedHistoryData =
  | usbvideo.IRxEnvelope
  | st3215.IInferenceState
  | motors_mirroring.IRxEnvelope
  | sysinfo.IEnvelope
  | yahboom_dogzilla_lite.IInferenceState
  | normvla.IFrame;

export function formatBytes(bytes: Uint8Array, maxBytes: number = 256): string {
  if (!bytes) return '';
  return Array.from(bytes.slice(0, maxBytes))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

export function formatBytesAsText(bytes: Uint8Array, maxBytes: number = 64): string {
  return Array.from(bytes.slice(0, maxBytes))
    .map(byte => (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.')
    .join('');
}

export function formatBytesAsHexdump(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  const bytesPerRow = 16;
  const header = ' '.repeat(8) + '  ' + Array.from({ length: bytesPerRow }, (_, i) => i.toString(16).padStart(2, '0')).join(' ');
  const lines = [header];
  for (let i = 0; i < bytes.length; i += bytesPerRow) {
    const chunk = bytes.slice(i, i + bytesPerRow);
    const address = i.toString(16).padStart(8, '0');
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    lines.push(`${address}  ${hex}`);
  }
  return `\n${lines.join('\n')}\n`;
}

export function formatTimestamp(stamp: frame.IFrameStamp): string {
  try {
    if (stamp.localStampNs) {
      const localTime = serverToLocal(stamp.monotonicStampNs || 0);
      const localTimeNumber = typeof localTime === 'number' ? localTime : Number(localTime);
      return new Date(localTimeNumber / 1000000).toISOString();
    }
    return 'No timestamp';
  } catch {
    return `${stamp.localStampNs?.toString() || 'unknown'}ns`;
  }
}

export function createJpegBlobUrl(frameData: Uint8Array): string | null {
  try {
    const newData = new Uint8Array(frameData);
    const blob = new Blob([newData], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch {
    console.error('Failed to create JPEG blob');
    return null;
  }
}

export function createCroppedJson(data: usbvideo.RxEnvelope): string {
  try {
    const plainObject = usbvideo.RxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });

    const croppedObject = { ...plainObject };

    if (croppedObject.frames) {
      if (croppedObject.frames.framesData && Array.isArray(croppedObject.frames.framesData)) {
        croppedObject.frames.framesData = croppedObject.frames.framesData.map((frameData: string, idx: number) => {
          if (typeof frameData === 'string' && frameData.length > 100) {
            return `[Frame ${idx + 1}: ${frameData.length} bytes] ${frameData.substring(0, 50)}...`;
          }
          return frameData;
        });
      }

      if (croppedObject.frames.linearData && typeof croppedObject.frames.linearData === 'string' && croppedObject.frames.linearData.length > 100) {
        croppedObject.frames.linearData = `[${croppedObject.frames.linearData.length} bytes] ${croppedObject.frames.linearData.substring(0, 50)}...`;
      }
    }

    return JSON.stringify(croppedObject, null, 2);
  } catch (error) {
    return `Error creating JSON: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export interface St3215HexdumpResult {
  jsonString: string;
  hexdumps: { placeholder: string; content: string }[];
}

export function getSt3215JsonData(data: st3215.InferenceState): St3215HexdumpResult {
  const plainObject = st3215.InferenceState.toObject(data, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true
  });

  const hexdumps: { placeholder: string; content: string }[] = [];

  if (data.buses && plainObject.buses) {
    data.buses.forEach((bus, busIndex) => {
      if (bus.motors && plainObject.buses[busIndex] && plainObject.buses[busIndex].motors) {
        bus.motors.forEach((motor, motorIndex) => {
          if (motor.state && motor.state.length > 0) {
            if (plainObject.buses[busIndex].motors[motorIndex]) {
              const placeholder = `__HEXDUMP_PLACEHOLDER_${busIndex}_${motorIndex}__`;
              (plainObject.buses[busIndex].motors[motorIndex] as Record<string, unknown>).state = placeholder;
              hexdumps.push({ placeholder, content: formatBytesAsHexdump(motor.state) });
            }
          }
        });
      }
    });
  }

  return { jsonString: JSON.stringify(plainObject, null, 2), hexdumps };
}

export function parseUsbVideoData(data: Uint8Array | ParsedHistoryData): usbvideo.RxEnvelope | null {
  if (!(data instanceof Uint8Array)) {
    return data as usbvideo.RxEnvelope;
  }
  try {
    return usbvideo.RxEnvelope.decode(data);
  } catch (error) {
    console.error('Failed to parse usbvideo.RxEnvelope:', error);
    return null;
  }
}

export function parseSt3215Data(data: Uint8Array | ParsedHistoryData): st3215.InferenceState | null {
  if (!(data instanceof Uint8Array)) {
    return data as st3215.InferenceState;
  }
  try {
    return st3215.InferenceState.decode(data);
  } catch (error) {
    console.error('Failed to parse st3215.InferenceState:', error);
    return null;
  }
}

export function parseMirroringData(data: Uint8Array | ParsedHistoryData): motors_mirroring.RxEnvelope | null {
  if (!(data instanceof Uint8Array)) {
    return data as motors_mirroring.RxEnvelope;
  }
  try {
    return motors_mirroring.RxEnvelope.decode(data);
  } catch (error) {
    console.error('Failed to parse motors_mirroring.RxEnvelope:', error);
    return null;
  }
}

export function parseSysinfoData(data: Uint8Array | ParsedHistoryData): sysinfo.Envelope | null {
  if (!(data instanceof Uint8Array)) {
    return data as sysinfo.Envelope;
  }
  try {
    return sysinfo.Envelope.decode(data);
  } catch (error) {
    console.error('Failed to parse sysinfo.Envelope:', error);
    return null;
  }
}

export function parseYahboomDogzillaLiteData(data: Uint8Array | ParsedHistoryData): yahboom_dogzilla_lite.InferenceState | null {
  if (!(data instanceof Uint8Array)) {
    return data as yahboom_dogzilla_lite.InferenceState;
  }
  try {
    return yahboom_dogzilla_lite.InferenceState.decode(data);
  } catch (error) {
    console.error('Failed to parse yahboom_dogzilla_lite.InferenceState:', error);
    return null;
  }
}

export function parseNormvlaData(data: Uint8Array | normvla.IFrame): normvla.Frame | null {
  if (!(data instanceof Uint8Array)) {
    return data as normvla.Frame;
  }
  try {
    return normvla.Frame.decode(data);
  } catch (error) {
    console.error('Failed to parse normvla.Frame:', error);
    return null;
  }
}
