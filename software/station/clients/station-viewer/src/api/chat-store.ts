import Long from 'long';
import { normfs } from '@/api/proto.js';
import webSocketManager from '@/api/websocket.js';
import { ErrQueueNotFound, StreamEntry } from '@/api/normfs.js';
import { entryIdToIndex, indexToEntryOffset } from '@/chat/message-paging';
import { isChatSessionRecord, reduceChatSessionEvents } from '@/chat/session-state';
import { CHAT_MESSAGE_RECORD_TYPE, CHAT_SESSION_RECORD_TYPE } from '@/chat/types';
import type {
  ChatMessage,
  ChatMessagePage,
  ChatMessageRecord,
  ChatSession,
  ChatSessionRecord,
  ChatSessionWriteRecordType,
} from '@/chat/types';

export type { ChatMessage, ChatSession } from '@/chat/types';

const CHAT_SESSIONS_QUEUE = 'chat/sessions';
const CHAT_MESSAGES_QUEUE_PREFIX = 'chat/messages';
const CHAT_SCHEMA_VERSION = 1;
const MAX_SESSION_EVENTS = 1000;
const MAX_MESSAGES_PER_SESSION = 1000;
const CHAT_MESSAGES_PAGE_SIZE = 50;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function isEntryNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Entry not found';
}

function readEntries(
  queueId: string,
  offset: Uint8Array,
  offsetType: normfs.OffsetType,
  limit: number,
): Promise<StreamEntry[]> {
  return new Promise((resolve, reject) => {
    const stream = webSocketManager.normFs.read(
      queueId,
      offset,
      offsetType,
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

function readRecentEntries(queueId: string, limit: number): Promise<StreamEntry[]> {
  const offset = new Uint8Array(Long.fromNumber(limit, true).toBytesLE());
  return readEntries(queueId, offset, normfs.OffsetType.OT_SHIFT_FROM_TAIL, limit);
}

function readAbsoluteEntries(queueId: string, startIndex: number, limit: number): Promise<StreamEntry[]> {
  return readEntries(
    queueId,
    indexToEntryOffset(startIndex),
    normfs.OffsetType.OT_ABSOLUTE,
    limit,
  );
}

function decodeChatMessages(entries: StreamEntry[], sessionId: string): ChatMessage[] {
  const messagesById = new Map<string, ChatMessage>();

  for (const entry of entries) {
    const record = decodeJson<ChatMessageRecord>(entry.data);
    if (
      record?.version === CHAT_SCHEMA_VERSION &&
      record.type === CHAT_MESSAGE_RECORD_TYPE.CREATE &&
      record.message?.sessionId === sessionId
    ) {
      messagesById.set(record.message.id, record.message);
    }
  }

  return Array.from(messagesById.values()).sort((a, b) => (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ));
}

function buildChatMessagePage(
  sessionId: string,
  entries: StreamEntry[],
  hasMoreBefore: boolean,
): ChatMessagePage {
  return {
    messages: decodeChatMessages(entries, sessionId),
    oldestEntryId: entries[0]?.id ?? null,
    newestEntryId: entries[entries.length - 1]?.id ?? null,
    hasMoreBefore,
  };
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

async function saveChatSessionEvent(
  type: ChatSessionWriteRecordType,
  session: ChatSession,
): Promise<void> {
  const record: ChatSessionRecord = {
    version: CHAT_SCHEMA_VERSION,
    type,
    session,
  };
  await webSocketManager.normFs.enqueue(CHAT_SESSIONS_QUEUE, encodeJson(record));
}

export async function saveChatSessionCreated(session: ChatSession): Promise<void> {
  await saveChatSessionEvent(CHAT_SESSION_RECORD_TYPE.CREATE, session);
}

export async function saveChatSessionUpdated(session: ChatSession): Promise<void> {
  await saveChatSessionEvent(CHAT_SESSION_RECORD_TYPE.UPDATE, session);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const record: ChatSessionRecord = {
    version: CHAT_SCHEMA_VERSION,
    type: CHAT_SESSION_RECORD_TYPE.DELETE,
    sessionId,
    deletedAt: new Date().toISOString(),
  };
  await webSocketManager.normFs.enqueue(CHAT_SESSIONS_QUEUE, encodeJson(record));
}

export async function loadChatSessions(): Promise<ChatSession[]> {
  const entries = await readRecentEntries(CHAT_SESSIONS_QUEUE, MAX_SESSION_EVENTS);
  const records: ChatSessionRecord[] = [];

  for (const entry of entries) {
    const record = decodeJson<ChatSessionRecord>(entry.data);
    if (isChatSessionRecord(record, CHAT_SCHEMA_VERSION)) {
      records.push(record);
    }
  }

  return reduceChatSessionEvents(records);
}

export async function saveChatMessage(message: ChatMessage): Promise<void> {
  const record: ChatMessageRecord = {
    version: CHAT_SCHEMA_VERSION,
    type: CHAT_MESSAGE_RECORD_TYPE.CREATE,
    message,
  };
  await webSocketManager.normFs.enqueue(sessionMessagesQueue(message.sessionId), encodeJson(record));
}

export async function loadRecentChatMessages(
  sessionId: string,
  limit = CHAT_MESSAGES_PAGE_SIZE,
): Promise<ChatMessagePage> {
  const entries = await readRecentEntries(sessionMessagesQueue(sessionId), limit);
  const oldestEntryIndex = entries[0] ? entryIdToIndex(entries[0].id) : 0;
  return buildChatMessagePage(sessionId, entries, entries.length >= limit && oldestEntryIndex > 0);
}

export async function loadChatMessagesBefore(
  sessionId: string,
  beforeEntryId: Uint8Array,
  limit = CHAT_MESSAGES_PAGE_SIZE,
): Promise<ChatMessagePage> {
  const beforeIndex = entryIdToIndex(beforeEntryId);
  if (beforeIndex <= 0) {
    return buildChatMessagePage(sessionId, [], false);
  }

  const startIndex = Math.max(0, beforeIndex - limit);
  const pageLimit = beforeIndex - startIndex;
  const queueId = sessionMessagesQueue(sessionId);

  try {
    const entries = await readAbsoluteEntries(queueId, startIndex, pageLimit);
    const oldestEntryIndex = entries[0] ? entryIdToIndex(entries[0].id) : 0;
    return buildChatMessagePage(sessionId, entries, entries.length > 0 && oldestEntryIndex > 0);
  } catch (err) {
    if (startIndex === 0 && beforeIndex > 1 && isEntryNotFoundError(err)) {
      const fallbackStartIndex = 1;
      const fallbackLimit = beforeIndex - fallbackStartIndex;
      if (fallbackLimit <= 0) {
        return buildChatMessagePage(sessionId, [], false);
      }
      const entries = await readAbsoluteEntries(queueId, fallbackStartIndex, fallbackLimit);
      const oldestEntryIndex = entries[0] ? entryIdToIndex(entries[0].id) : 0;
      return buildChatMessagePage(sessionId, entries, entries.length > 0 && oldestEntryIndex > 0);
    }
    throw err;
  }
}

export async function loadChatMessages(sessionId: string): Promise<ChatMessage[]> {
  const page = await loadRecentChatMessages(sessionId, MAX_MESSAGES_PER_SESSION);
  return page.messages;
}
