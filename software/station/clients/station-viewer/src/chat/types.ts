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

export const CHAT_SESSION_RECORD_TYPE = {
  CREATE: 'session.create',
  UPDATE: 'session.update',
  UPSERT: 'session.upsert',
  DELETE: 'session.delete',
} as const;

export const CHAT_MESSAGE_RECORD_TYPE = {
  CREATE: 'message.create',
} as const;

export type ChatSessionWriteRecordType =
  | typeof CHAT_SESSION_RECORD_TYPE.CREATE
  | typeof CHAT_SESSION_RECORD_TYPE.UPDATE;

export type ChatSessionWithPayloadRecordType =
  | ChatSessionWriteRecordType
  | typeof CHAT_SESSION_RECORD_TYPE.UPSERT;

export type ChatSessionRecord =
  | {
      version: number;
      type: ChatSessionWithPayloadRecordType;
      session: ChatSession;
    }
  | {
      version: number;
      type: typeof CHAT_SESSION_RECORD_TYPE.DELETE;
      sessionId: string;
      deletedAt: string;
    };

export interface ChatMessageRecord {
  version: number;
  type: typeof CHAT_MESSAGE_RECORD_TYPE.CREATE;
  message: ChatMessage;
}

export type MessageSaveState = 'pending' | 'saved' | 'failed';
export type MobileView = 'sessions' | 'conversation';
export type SessionSaveMode = 'create' | 'update';

export interface ChatMessageView extends ChatMessage {
  saveState: MessageSaveState;
  error?: string;
}

export interface ChatMessagePage {
  messages: ChatMessage[];
  oldestEntryId: Uint8Array | null;
  newestEntryId: Uint8Array | null;
  hasMoreBefore: boolean;
}

export interface ChatMessagePagingState {
  oldestEntryId: Uint8Array | null;
  hasMoreBefore: boolean;
}

export interface ChatScrollSnapshot {
  scrollHeight: number;
  scrollTop: number;
  restore: () => void;
}

export interface MessageGroup {
  key: string;
  dateKey: string;
  dateLabel: string;
  messages: ChatMessageView[];
}
