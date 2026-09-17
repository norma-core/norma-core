import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatScrollSnapshot } from './types';

const SCROLL_BOTTOM_THRESHOLD_PX = 96;
const SCROLL_TOP_THRESHOLD_PX = 96;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function createScrollSnapshot(element: HTMLElement): ChatScrollSnapshot {
  const scrollHeight = element.scrollHeight;
  const scrollTop = element.scrollTop;

  return {
    scrollHeight,
    scrollTop,
    restore: () => {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight - scrollHeight + scrollTop;
      });
    },
  };
}

interface UseChatScrollParams {
  activeSessionId: string | null;
  activeMessagesLength: number;
  isLoadingMessages: boolean;
  onLoadOlderMessages: (snapshot: ChatScrollSnapshot) => void;
}

export function useChatScroll({
  activeSessionId,
  activeMessagesLength,
  isLoadingMessages,
  onLoadOlderMessages,
}: UseChatScrollParams) {
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastActiveSessionIdRef = useRef<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const sessionChanged = lastActiveSessionIdRef.current !== activeSessionId;
    if (sessionChanged) {
      lastActiveSessionIdRef.current = activeSessionId;
      shouldAutoScrollRef.current = true;
      setShowScrollToBottom(false);
    }

    if (sessionChanged || shouldAutoScrollRef.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end' });
      });
    }
  }, [activeSessionId, activeMessagesLength, isLoadingMessages]);

  const handleMessagesScroll = useCallback(() => {
    const element = messagesScrollRef.current;
    if (!element) {
      return;
    }

    const atBottom = isNearBottom(element);
    shouldAutoScrollRef.current = atBottom;
    setShowScrollToBottom(!atBottom);

    if (element.scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
      onLoadOlderMessages(createScrollSnapshot(element));
    }
  }, [onLoadOlderMessages]);

  const handleScrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  return {
    messagesScrollRef,
    messagesEndRef,
    showScrollToBottom,
    handleMessagesScroll,
    handleScrollToBottom,
  };
}
