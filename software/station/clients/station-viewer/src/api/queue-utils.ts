/**
 * Maps a queue ID from inference data to the actual queue ID used for reading.
 * Handles usbvideo prefix and camera queues that already include a namespace.
 */
export function mapQueueId(queueId: string): string {
  if (queueId === 'st3215/tx') {
    return 'st3215/rx';
  }
  if (queueId === 'video/ov5647' || queueId.startsWith('video/ov5647/')) {
    return queueId;
  }
  if (!queueId.includes('/')) {
    return `usbvideo/${queueId}`;
  }
  return queueId;
}

import { drivers } from '@/api/proto.js';

/**
 * Determines the queue type based on the queue data type enum.
 * Used for type-specific rendering in UI components.
 */
export function getQueueType(queueType: drivers.QueueDataType): string | undefined {
  switch (queueType) {
    case drivers.QueueDataType.QDT_USB_VIDEO_FRAMES:
      return 'usbvideo';
    case drivers.QueueDataType.QDT_USB_VIDEO_TX:
      return 'usbvideo-tx';
    case drivers.QueueDataType.QDT_HIKMICRO_THERMAL:
      return 'hikmicro-thermal';
    case drivers.QueueDataType.QDT_ST3215_INFERENCE:
      return 'st3215';
    case drivers.QueueDataType.QDT_ST3215_SERIAL_TX:
      return 'st3215tx';
    case drivers.QueueDataType.QDT_VESC_TRAMPA_INFERENCE:
      return 'vesc-trampa';
    case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_RX:
      return 'vesc-trampa-rx';
    case drivers.QueueDataType.QDT_VESC_TRAMPA_SERIAL_TX:
      return 'vesc-trampa-tx';
    case drivers.QueueDataType.QDT_MOTOR_MIRRORING_RX:
      return 'mirroring';
    case drivers.QueueDataType.QDT_SYSTEM:
      return 'sysinfo';
    case drivers.QueueDataType.QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE:
      return 'yahboom_dogzilla_lite';
    case drivers.QueueDataType.QDT_ARDUINO_NICLA_SENSE_ENV_RX:
      return 'arduino-nicla-sense-env';
    case drivers.QueueDataType.QDT_INA226_RX:
      return 'ina226';
    case drivers.QueueDataType.QDT_DFROBOT_RS485_RX:
      return 'dfrobot-rs485';
    case drivers.QueueDataType.QDT_AIRGRADIENT_OPEN_AIR_O_1PST_RX:
      return 'airgradient-open-air-o-1pst';
    case drivers.QueueDataType.QDT_VICTRON_SMARTSOLAR_MPPT_RX:
      return 'victron-smartsolar-mppt';
    case drivers.QueueDataType.QDT_DMESG_RX:
      return 'dmesg';
    default:
      return undefined;
  }
}

export function getQueueTypeWithId(queueType: drivers.QueueDataType, queueId: string): string | undefined {
  if (queueId.endsWith('/inference/normvla')) {
    return 'normvla';
  }
  return getQueueType(queueType);
}

/**
 * Formats a queue name for display, adding the usbvideo prefix if missing.
 */
export function formatQueueName(queueId: string): string {
  if (queueId === 'video/ov5647' || queueId.startsWith('video/ov5647/')) {
    return queueId;
  }
  if (!queueId.includes('/')) {
    return `usbvideo/${queueId}`;
  }
  return queueId;
}
