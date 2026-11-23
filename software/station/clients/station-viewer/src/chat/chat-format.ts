import type { ChatMessage, ChatMessageView, ChatSession } from './types';

export function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}

export function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateSeparator(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const options: Intl.DateTimeFormatOptions = date.getFullYear() === today.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function buildSessionTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/u)[0] ?? 'New chat';
  if (firstLine.length <= 48) {
    return firstLine;
  }
  return `${firstLine.slice(0, 45)}...`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown chat storage error';
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((item) => item.id !== session.id)];
}

export function summarizeSession(session: ChatSession, messages: ChatMessageView[]): ChatSession {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return session;
  }

  return {
    ...session,
    title: session.title === 'New chat' ? buildSessionTitle(latestMessage.text) : session.title,
    updatedAt: latestMessage.createdAt,
    lastMessagePreview: latestMessage.text,
    messageCount: messages.length,
  };
}

export function fallbackSessionFromMessage(message: ChatMessage): ChatSession {
  return {
    id: message.sessionId,
    title: buildSessionTitle(message.text),
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    lastMessagePreview: message.text,
    messageCount: 1,
  };
}
