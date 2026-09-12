import { CHAT_SESSION_RECORD_TYPE } from './types';
import type { ChatSession, ChatSessionRecord } from './types';

export function reduceChatSessionEvents(records: ChatSessionRecord[]): ChatSession[] {
  const sessionsById = new Map<string, ChatSession>();
  const deletedSessionIds = new Set<string>();

  for (const record of records) {
    if (record.type === CHAT_SESSION_RECORD_TYPE.CREATE) {
      deletedSessionIds.delete(record.session.id);
      sessionsById.set(record.session.id, record.session);
      continue;
    }

    if (
      record.type === CHAT_SESSION_RECORD_TYPE.UPDATE ||
      record.type === CHAT_SESSION_RECORD_TYPE.UPSERT
    ) {
      if (!deletedSessionIds.has(record.session.id)) {
        sessionsById.set(record.session.id, record.session);
      }
      continue;
    }

    if (record.type === CHAT_SESSION_RECORD_TYPE.DELETE) {
      sessionsById.delete(record.sessionId);
      deletedSessionIds.add(record.sessionId);
    }
  }

  return Array.from(sessionsById.values()).sort((a, b) => (
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ));
}

export function isChatSessionRecord(value: ChatSessionRecord | null, version: number): value is ChatSessionRecord {
  if (value?.version !== version) {
    return false;
  }

  if (value.type === CHAT_SESSION_RECORD_TYPE.DELETE) {
    return Boolean(value.sessionId);
  }

  return Boolean(value.session?.id);
}
