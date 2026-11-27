import { drivers, type inference } from '@/api/proto.js';

const Q = drivers.QueueDataType;
export type QueueDescriptor = inference.InferenceRx.IEntry;

// Detect the same VESC + PWM operating surface from descriptors, before any
// payload reads. History does not use this policy. No diagnostic bootstrap fetch.
export function isRoverQueueSet(entries: readonly QueueDescriptor[]): boolean {
  return entries.some(e => e.type === Q.QDT_VESC_TRAMPA_INFERENCE)
    && entries.some(e => e.type === Q.QDT_PWM_OUTPUT_RX || e.type === Q.QDT_PWM_OUTPUT_TX);
}

export class LiveQueuePolicy {
  private lastRead = new Map<string, number>();
  private appStart = '';

  reset() { this.lastRead.clear(); this.appStart = ''; }

  select(snapshot: inference.IInferenceRx, now: number): {
    queues: Set<string> | null;
    shouldRead: (queue: string) => boolean;
  } {
    const appStart = snapshot.appStartId?.toString() ?? '';
    if (appStart !== this.appStart) { this.lastRead.clear(); this.appStart = appStart; }
    const entries = snapshot.entries ?? [];
    if (!isRoverQueueSet(entries)) {
      this.lastRead.clear();
      return { queues: null, shouldRead: () => true };
    }
    // Single operating camera and IMU, selected deterministically. Additional
    // cameras and sensors remain available to History without being downloaded.
    const queues = new Set<string>();
    const video = new Set<string>();
    const power = new Set<string>();
    for (const type of [Q.QDT_VESC_TRAMPA_INFERENCE,
      Q.QDT_USB_VIDEO_FRAMES, Q.QDT_ARDUINO_NICLA_SENSE_ME_RX, Q.QDT_VICTRON_SMARTSOLAR_MPPT_RX]) {
      const queue = entries.filter(e => e.type === type && e.queue).map(e => e.queue!).sort()[0];
      if (queue) {
        queues.add(queue);
        if (type === Q.QDT_USB_VIDEO_FRAMES) video.add(queue);
        if (type === Q.QDT_VICTRON_SMARTSOLAR_MPPT_RX) power.add(queue);
      }
    }
    return {
      queues,
      shouldRead: (queue) => {
        if (video.has(queue)) return true;
        const last = this.lastRead.get(queue);
        if (last !== undefined && now - last < (power.has(queue) ? 1000 : 100)) return false;
        this.lastRead.set(queue, now);
        return true;
      },
    };
  }
}
