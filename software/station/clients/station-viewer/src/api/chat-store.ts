import Long from 'long';
import { normfs } from '@/api/proto.js';
import webSocketManager from '@/api/websocket.js';
import { ErrQueueNotFound, StreamEntry } from '@/api/normfs.js';

const CHAT_SESSIONS_QUEUE = 'chat/sessions';
const CHAT_MESSAGES_QUEUE_PREFIX = 'chat/messages';
const CHAT_SCHEMA_VERSION = 1;
const MAX_SESSION_EVENTS = 1000;
const MAX_MESSAGES_PER_SESSION = 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user';
  text: string;
  createdAt: string;
}

interface ChatSessionRecord {
  version: number;
  type: 'session.upsert' | 'session.delete';
  session?: ChatSession;
  sessionId?: string;
  deletedAt?: string;
}

interface ChatMessageRecord {
  version: number;
  type: 'message.create';
  message: ChatMessage;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function encodeJson(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

function decodeJson<T>(data: Uint8Array): T | null {
  try {
    return JSON.parse(textDecoder.decode(data)) as T;
  } catch (err) {
    console.warn('[chat-store] failed to decode NormFS entry:', err);
    return null;
  }
}

function toUint8Array(data: Uint8Array | number[] | ArrayBufferLike): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data);
}

function sessionMessagesQueue(sessionId: string): string {
  return `${CHAT_MESSAGES_QUEUE_PREFIX}/${sessionId}`;
}

function isQueueMissingError(err: unknown): boolean {
  if (err === ErrQueueNotFound) {
    return true;
  }
  if (err instanceof Error) {
    return err.message === 'Queue empty' || err.message === 'queue not found on server';
  }
  return false;
}

function readRecentEntries(queueId: string, limit: number): Promise<StreamEntry[]> {
  return new Promise((resolve, reject) => {
    const offset = new Uint8Array(Long.fromNumber(limit).toBytesLE());
    const stream = webSocketManager.normFs.read(
      queueId,
      offset,
      normfs.OffsetType.OT_SHIFT_FROM_TAIL,
      limit,
    );
    const entries: StreamEntry[] = [];

    const onData = (event: Event) => {
      const readResponse = (event as CustomEvent).detail as normfs.IReadResponse;
      if (!readResponse.data || !readResponse.id?.raw) {
        return;
      }
      entries.push({
        id: toUint8Array(readResponse.id.raw as Uint8Array | number[] | ArrayBufferLike),
        data: toUint8Array(readResponse.data as Uint8Array | number[] | ArrayBufferLike),
      });
    };

    const onEnd = () => {
      cleanup();
      resolve(entries);
    };

    const onError = (event: Event) => {
      cleanup();
      const err = (event as CustomEvent).detail;
      if (isQueueMissingError(err)) {
        resolve([]);
        return;
      }
      reject(err);
    };

    const cleanup = () => {
      stream.removeEventListener('data', onData);
      stream.removeEventListener('end', onEnd);
      stream.removeEventListener('error', onError);
    };

    stream.addEventListener('data', onData);
    stream.addEventListener('end', onEnd);
    stream.addEventListener('error', onError);
  });
}

export function createChatSession(title = 'New chat'): ChatSession {
  const now = new Date().toISOString();
  return {
    id: createId('session'),
    title,
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: '',
    messageCount: 0,
  };
}

export function createUserMessage(sessionId: string, text: string): ChatMessage {
  return {
    id: createId('message'),
    sessionId,
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
  };
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const record: ChatSessionRecord = {
    version: CHAT_SCHEMA_VERSION,
    type: 'session.upsert',
    session,
  };
  await webSocketManager.normFs.enqueue(CHAT_SESSIONS_QUEUE, encodeJson(record));
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const record: ChatSessionRecord = {
    version: CHAT_SCHEMA_VERSION,
    type: 'session.delete',
    sessionId,
    deletedAt: new Date().toISOString(),
  };
  await webSocketManager.normFs.enqueue(CHAT_SESSIONS_QUEUE, encodeJson(record));
}

export async function loadChatSessions(): Promise<ChatSession[]> {
  const entries = await readRecentEntries(CHAT_SESSIONS_QUEUE, MAX_SESSION_EVENTS);
  const sessionsById = new Map<string, ChatSession>();
  const deletedSessionIds = new Set<string>();

  for (const entry of entries) {
    const record = decodeJson<ChatSessionRecord>(entry.data);
    if (
      record?.version === CHAT_SCHEMA_VERSION &&
      record.type === 'session.upsert' &&
      record.session?.id
    ) {
      deletedSessionIds.delete(record.session.id);
      sessionsById.set(record.session.id, record.session);
      continue;
    }

    if (
      record?.version === CHAT_SCHEMA_VERSION &&
      record.type === 'session.delete' &&
      record.sessionId
    ) {
      sessionsById.delete(record.sessionId);
      deletedSessionIds.add(record.sessionId);
    }
  }

  return Array.from(sessionsById.values()).filter((session) => (
    !deletedSessionIds.has(session.id)
  )).sort((a, b) => (
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ));
}

export async function saveChatMessage(message: ChatMessage): Promise<void> {
  const record: ChatMessageRecord = {
    version: CHAT_SCHEMA_VERSION,
    type: 'message.create',
    message,
  };
  await webSocketManager.normFs.enqueue(sessionMessagesQueue(message.sessionId), encodeJson(record));
}

export async function loadChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const entries = await readRecentEntries(sessionMessagesQueue(sessionId), MAX_MESSAGES_PER_SESSION);
  const messagesById = new Map<string, ChatMessage>();

  for (const entry of entries) {
    const record = decodeJson<ChatMessageRecord>(entry.data);
    if (
      record?.version === CHAT_SCHEMA_VERSION &&
      record.type === 'message.create' &&
      record.message?.sessionId === sessionId
    ) {
      messagesById.set(record.message.id, record.message);
    }
  }

  return Array.from(messagesById.values()).sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));
}
