import { usbvideo } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs.js';
import { idFromBytes, idToBytes } from './vp8-chain.js';

type Session = Pick<usbvideo.IRxEnvelope, 'camera' | 'formats'>;

const MAX_SESSIONS = 64;
// A session record can still be on its way to the bucket; asked again after this.
const RETRY_MS = 5_000;

const sessions = new Map<string, Session>();
const loading = new Map<string, Promise<Session | null>>();
const missedAt = new Map<string, number>();

function key(queueId: string, id: bigint): string {
  return `${queueId}#${id}`;
}

function sessionOf(envelope: usbvideo.IRxEnvelope): bigint | null {
  const ptr = envelope.sessionPtr;
  return envelope.formats?.length || !ptr || ptr.length === 0 ? null : idFromBytes(ptr);
}

function fill(envelope: usbvideo.IRxEnvelope, session: Session): usbvideo.IRxEnvelope {
  // A decoded message keeps defaults such as `type` on its prototype, which a
  // spread drops.
  return Object.assign(Object.create(Object.getPrototypeOf(envelope)), envelope, {
    camera: envelope.camera ?? session.camera,
    formats: session.formats,
  });
}

export function rememberCaptureSession(queueId: string, id: bigint, envelope: usbvideo.IRxEnvelope): void {
  if (envelope.type !== usbvideo.RxEnvelopeType.ET_CAPTURE_SESSION) {
    return;
  }
  const k = key(queueId, id);
  sessions.delete(k);
  sessions.set(k, { camera: envelope.camera, formats: envelope.formats });
  missedAt.delete(k);
  if (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value!);
  }
}

/** The frame with the formats of its session, when that is already known. */
export function withCaptureSession(queueId: string, envelope: usbvideo.IRxEnvelope): usbvideo.IRxEnvelope {
  const id = sessionOf(envelope);
  const session = id === null ? undefined : sessions.get(key(queueId, id));
  return session ? fill(envelope, session) : envelope;
}

/** As withCaptureSession, reading the session record when it is not known yet. */
export async function resolveCaptureSession(
  normFs: Pick<NormFsClient, 'readSingleEntry'>,
  queueId: string,
  envelope: usbvideo.IRxEnvelope,
): Promise<usbvideo.IRxEnvelope> {
  const id = sessionOf(envelope);
  if (id === null) {
    return envelope;
  }
  const k = key(queueId, id);
  const known = sessions.get(k);
  if (known) {
    return fill(envelope, known);
  }
  if (Date.now() - (missedAt.get(k) ?? 0) < RETRY_MS) {
    return envelope;
  }
  let pending = loading.get(k);
  if (!pending) {
    pending = normFs
      .readSingleEntry(queueId, idToBytes(id))
      .then((entry) => {
        const record = usbvideo.RxEnvelope.decode(entry.data);
        rememberCaptureSession(queueId, id, record);
        return sessions.get(k) ?? null;
      })
      .catch((error) => {
        console.warn(`Camera session ${id} of ${queueId} is not readable yet:`, error);
        return null;
      })
      .then((session) => {
        loading.delete(k);
        if (!session) {
          missedAt.set(k, Date.now());
        }
        return session;
      });
    loading.set(k, pending);
  }
  const session = await pending;
  return session ? fill(envelope, session) : envelope;
}
