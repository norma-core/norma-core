import { formatDateSeparator } from './chat-format';
import type { ChatMessageView, MessageGroup } from './types';

const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

export function groupMessages(messages: ChatMessageView[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const createdAt = new Date(message.createdAt);
    const dateKey = Number.isNaN(createdAt.getTime())
      ? 'unknown'
      : createdAt.toDateString();
    const previousGroup = groups[groups.length - 1];
    const previousMessage = previousGroup?.messages[previousGroup.messages.length - 1];
    const previousDate = previousMessage ? new Date(previousMessage.createdAt) : null;
    const isCloseToPrevious = previousDate && !Number.isNaN(previousDate.getTime())
      ? createdAt.getTime() - previousDate.getTime() <= MESSAGE_GROUP_GAP_MS
      : false;

    if (
      !previousGroup ||
      previousGroup.dateKey !== dateKey ||
      previousMessage?.role !== message.role ||
      !isCloseToPrevious
    ) {
      groups.push({
        key: `${dateKey}-${message.id}`,
        dateKey,
        dateLabel: formatDateSeparator(message.createdAt),
        messages: [message],
      });
      continue;
    }

    previousGroup.messages.push(message);
  }

  return groups;
}
