import type { ChatMessage, ChatMessageView, MessageSaveState } from './types';

function messageTimestamp(message: ChatMessage): number {
  const timestamp = new Date(message.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function withSavedState(messages: ChatMessage[]): ChatMessageView[] {
  return messages.map((message) => ({
    ...message,
    saveState: 'saved',
  }));
}

export function mergeMessageViews(
  currentMessages: ChatMessageView[],
  incomingMessages: ChatMessageView[],
): ChatMessageView[] {
  const messagesById = new Map<string, ChatMessageView>();

  for (const message of incomingMessages) {
    messagesById.set(message.id, message);
  }
  for (const message of currentMessages) {
    messagesById.set(message.id, message);
  }

  return Array.from(messagesById.values()).sort((a, b) => (
    messageTimestamp(a) - messageTimestamp(b)
  ));
}

export function updateMessageSaveState(
  messages: ChatMessageView[],
  messageId: string,
  saveState: MessageSaveState,
  saveError?: string,
): ChatMessageView[] {
  return messages.map((message) => (
    message.id === messageId
      ? { ...message, saveState, error: saveError }
      : message
  ));
}
