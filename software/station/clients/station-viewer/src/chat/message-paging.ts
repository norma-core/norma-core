import Long from 'long';
import type { ChatMessagePagingState } from './types';

export const EMPTY_MESSAGE_PAGING: ChatMessagePagingState = {
  oldestEntryId: null,
  hasMoreBefore: false,
};

export function entryIdToIndex(entryId: Uint8Array): number {
  return Long.fromBytesLE(Array.from(entryId), true).toNumber();
}

export function indexToEntryOffset(index: number): Uint8Array {
  return new Uint8Array(Long.fromNumber(Math.max(0, Math.floor(index)), true).toBytesLE());
}

function isEntryIdBefore(left: Uint8Array, right: Uint8Array): boolean {
  return entryIdToIndex(left) < entryIdToIndex(right);
}

export function mergeMessagePaging(
  current: ChatMessagePagingState | undefined,
  incoming: ChatMessagePagingState,
): ChatMessagePagingState {
  if (!current?.oldestEntryId) {
    return incoming;
  }
  if (!incoming.oldestEntryId) {
    return current;
  }

  if (isEntryIdBefore(current.oldestEntryId, incoming.oldestEntryId)) {
    return current;
  }

  return incoming;
}
