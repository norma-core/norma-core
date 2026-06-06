import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Clock,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  ChatMessage,
  ChatSession,
  createChatSession,
  createUserMessage,
  deleteChatSession,
  loadChatMessages,
  loadChatSessions,
  saveChatMessage,
  saveChatSession,
} from '@/api/chat-store';
import { useConnectionStats } from '@/hooks';

type MessageSaveState = 'pending' | 'saved' | 'failed';
type MobileView = 'sessions' | 'conversation';

interface ChatMessageView extends ChatMessage {
  saveState: MessageSaveState;
  error?: string;
}

interface MessageGroup {
  key: string;
  dateKey: string;
  dateLabel: string;
  messages: ChatMessageView[];
}

const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD_PX = 96;
const HEADER_ACTION_BUTTON_CLASS = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border';

function formatSessionTime(value: string): string {
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

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateSeparator(value: string): string {
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

function buildSessionTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/u)[0] ?? 'New chat';
  if (firstLine.length <= 48) {
    return firstLine;
  }
  return `${firstLine.slice(0, 45)}...`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown chat storage error';
}

function withSavedState(messages: ChatMessage[]): ChatMessageView[] {
  return messages.map((message) => ({
    ...message,
    saveState: 'saved',
  }));
}

function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((item) => item.id !== session.id)];
}

function summarizeSession(session: ChatSession, messages: ChatMessageView[]): ChatSession {
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

function fallbackSessionFromMessage(message: ChatMessage): ChatSession {
  return {
    id: message.sessionId,
    title: buildSessionTitle(message.text),
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    lastMessagePreview: message.text,
    messageCount: 1,
  };
}

function groupMessages(messages: ChatMessageView[]): MessageGroup[] {
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

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function ChatPage() {
  const connectionStats = useConnectionStats();
  const isConnected = connectionStats?.status === 'connected';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessageView[]>>({});
  const [draft, setDraft] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [mobileView, setMobileView] = useState<MobileView>('sessions');
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef('');
  const deletedSessionIdsRef = useRef(new Set<string>());
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastActiveSessionIdRef = useRef<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeMessages = useMemo(
    () => activeSessionId ? messagesBySession[activeSessionId] ?? [] : [],
    [activeSessionId, messagesBySession],
  );
  const messageGroups = useMemo(() => groupMessages(activeMessages), [activeMessages]);
  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    if (!query) {
      return sessions;
    }
    return sessions.filter((session) => (
      session.title.toLowerCase().includes(query) ||
      session.lastMessagePreview.toLowerCase().includes(query)
    ));
  }, [sessionQuery, sessions]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const reloadSessions = useCallback(async () => {
    if (!isConnected) {
      setIsLoadingSessions(false);
      return;
    }

    setIsLoadingSessions(true);
    setError(null);
    try {
      const loadedSessions = await loadChatSessions();
      setSessions(loadedSessions);
      setActiveSessionId((current) => {
        if (current && loadedSessions.some((session) => session.id === current)) {
          return current;
        }
        return loadedSessions[0]?.id ?? null;
      });
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
      setError(`Failed to load chat sessions: ${errorMessage(err)}`);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [isConnected]);

  const markMessageSaveState = useCallback((
    sessionId: string,
    messageId: string,
    saveState: MessageSaveState,
    saveError?: string,
  ) => {
    setMessagesBySession((current) => {
      const sessionMessages = current[sessionId] ?? [];
      return {
        ...current,
        [sessionId]: sessionMessages.map((message) => (
          message.id === messageId
            ? { ...message, saveState, error: saveError }
            : message
        )),
      };
    });
  }, []);

  const persistMessage = useCallback(async (
    session: ChatSession,
    message: ChatMessage,
    sessionMessages: ChatMessageView[],
  ) => {
    try {
      const nextSession = summarizeSession(session, sessionMessages);
      if (deletedSessionIdsRef.current.has(nextSession.id)) {
        return;
      }
      await saveChatMessage(message);
      if (deletedSessionIdsRef.current.has(nextSession.id)) {
        return;
      }
      await saveChatSession(nextSession);
      if (deletedSessionIdsRef.current.has(nextSession.id)) {
        return;
      }
      markMessageSaveState(message.sessionId, message.id, 'saved');
      setSessions((current) => upsertSession(current, nextSession));
      setError(null);
    } catch (err) {
      const messageError = errorMessage(err);
      console.error('Failed to save chat message:', err);
      markMessageSaveState(message.sessionId, message.id, 'failed', messageError);
      setError(`Failed to save message: ${messageError}`);
    }
  }, [markMessageSaveState]);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  useEffect(() => {
    if (!activeSessionId || !isConnected) {
      setIsLoadingMessages(false);
      return;
    }

    let cancelled = false;
    setIsLoadingMessages(true);
    setError(null);

    loadChatMessages(activeSessionId)
      .then((messages) => {
        if (cancelled) {
          return;
        }
        setMessagesBySession((current) => ({
          ...current,
          [activeSessionId]: withSavedState(messages),
        }));
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to load chat messages:', err);
        setError(`Failed to load chat history: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingMessages(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, isConnected]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const sessionChanged = lastActiveSessionIdRef.current !== activeSessionId;
    if (sessionChanged) {
      lastActiveSessionIdRef.current = activeSessionId;
      shouldAutoScrollRef.current = true;
    }

    if (sessionChanged || shouldAutoScrollRef.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end' });
      });
    }
  }, [activeSessionId, activeMessages.length, isLoadingMessages]);

  const handleCreateSession = useCallback(async () => {
    if (!isConnected || isCreatingSession) {
      return;
    }

    setIsCreatingSession(true);
    setError(null);
    try {
      const session = createChatSession();
      await saveChatSession(session);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setMessagesBySession((current) => ({ ...current, [session.id]: [] }));
      setActiveSessionId(session.id);
      setMobileView('conversation');
    } catch (err) {
      console.error('Failed to create chat session:', err);
      setError(`Failed to create chat session: ${errorMessage(err)}`);
    } finally {
      setIsCreatingSession(false);
    }
  }, [isConnected, isCreatingSession]);

  const handleDeleteSession = useCallback(async (session: ChatSession) => {
    if (!isConnected || deletingSessionId) {
      return;
    }

    const shouldDelete = window.confirm(`Delete "${session.title}"?`);
    if (!shouldDelete) {
      return;
    }

    deletedSessionIdsRef.current.add(session.id);
    setDeletingSessionId(session.id);
    setError(null);

    try {
      await deleteChatSession(session.id);
      const nextSessions = sessions.filter((item) => item.id !== session.id);
      setSessions(nextSessions);
      setMessagesBySession((current) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      });

      if (activeSessionId === session.id) {
        setActiveSessionId(nextSessions[0]?.id ?? null);
        if (nextSessions.length === 0) {
          setMobileView('sessions');
        }
      }
      setError(null);
    } catch (err) {
      deletedSessionIdsRef.current.delete(session.id);
      console.error('Failed to delete chat session:', err);
      setError(`Failed to delete chat: ${errorMessage(err)}`);
    } finally {
      setDeletingSessionId(null);
    }
  }, [activeSessionId, deletingSessionId, isConnected, sessions]);

  const submitMessage = useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text || !isConnected) {
      return;
    }

    draftRef.current = '';
    setDraft('');
    setError(null);
    let session = activeSession;
    const existingMessages = session ? messagesBySession[session.id] ?? [] : [];

    if (!session) {
      session = createChatSession(buildSessionTitle(text));
    }

    const message = createUserMessage(session.id, text);
    const optimisticMessage: ChatMessageView = {
      ...message,
      saveState: 'pending',
    };
    const nextMessages = [...existingMessages, optimisticMessage];
    const nextSession = summarizeSession(session, nextMessages);

    setMessagesBySession((current) => ({
      ...current,
      [nextSession.id]: nextMessages,
    }));
    setSessions((current) => upsertSession(current, nextSession));
    setActiveSessionId(nextSession.id);
    setMobileView('conversation');

    void persistMessage(nextSession, message, nextMessages);
  }, [activeSession, isConnected, messagesBySession, persistMessage]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setMobileView('conversation');
  }, []);

  const handleMessagesScroll = useCallback(() => {
    if (!messagesScrollRef.current) {
      return;
    }
    shouldAutoScrollRef.current = isNearBottom(messagesScrollRef.current);
  }, []);

  const handleRetryMessage = useCallback((message: ChatMessageView) => {
    if (!isConnected) {
      return;
    }

    const sessionMessages = messagesBySession[message.sessionId] ?? [];
    const session = sessions.find((item) => item.id === message.sessionId)
      ?? fallbackSessionFromMessage(message);
    const nextSession = summarizeSession(session, sessionMessages);
    const retryMessage: ChatMessage = {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    };

    markMessageSaveState(message.sessionId, message.id, 'pending');
    void persistMessage(nextSession, retryMessage, sessionMessages);
  }, [isConnected, markMessageSaveState, messagesBySession, persistMessage, sessions]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submitMessage();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex bg-surface-base text-text-primary">
      <aside className={`${mobileView === 'sessions' ? 'flex' : 'hidden'} min-h-0 w-full shrink-0 flex-col bg-surface-primary md:flex md:w-80 md:border-r-2 md:border-border-default`}>
        <div className="flex items-center gap-3 border-b border-border-default px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center text-accent-data" aria-hidden="true">
            <MessageSquare size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold uppercase tracking-wide text-text-primary">Chat</h1>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono text-text-muted">
              {isConnected ? (
                <Wifi size={12} className="text-accent-success" />
              ) : (
                <WifiOff size={12} className="text-accent-critical" />
              )}
              <span className="truncate">{connectionStats?.status ?? 'connecting'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void reloadSessions()}
            disabled={!isConnected || isLoadingSessions}
            className={`${HEADER_ACTION_BUTTON_CLASS} border-border-default bg-surface-secondary text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50`}
            title="Refresh sessions"
            aria-label="Refresh sessions"
          >
            <RefreshCw size={15} className={isLoadingSessions ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            disabled={!isConnected || isCreatingSession}
            className={`${HEADER_ACTION_BUTTON_CLASS} border-accent-success bg-accent-success-bg text-text-primary transition-colors hover:bg-accent-success-deep disabled:cursor-not-allowed disabled:opacity-50`}
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="border-b border-border-default px-4 py-3">
          <label className="flex h-9 items-center gap-2 rounded border border-border-default bg-surface-secondary px-3 text-sm text-text-secondary focus-within:border-accent-info">
            <Search size={14} className="shrink-0 text-text-muted" />
            <input
              type="search"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="Search sessions"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
          {!isConnected && (
            <div className="mt-3 flex items-center gap-2 text-xs text-accent-critical">
              <WifiOff size={13} />
              <span>Offline. Reconnect to sync.</span>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!isConnected && sessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-text-secondary">
              <WifiOff size={24} className="mb-3 text-accent-critical" />
              <p className="font-semibold text-text-primary">Station offline</p>
              <p className="mt-1">Reconnect to load chats.</p>
            </div>
          ) : isLoadingSessions ? (
            <div className="px-4 py-5 text-xs font-mono text-text-muted">Loading sessions from NormFS...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-text-secondary">
              <MessageSquare size={24} className="mb-3 text-accent-data" />
              <p className="font-semibold text-text-primary">
                {sessionQuery.trim() ? 'No matches' : 'No sessions'}
              </p>
              <p className="mt-1">{sessionQuery.trim() ? 'Try another search.' : 'Use + to start.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isDeleting = deletingSessionId === session.id;
                return (
                  <div
                    key={session.id}
                    className={`group flex items-stretch transition-colors ${
                      isActive
                        ? 'bg-accent-info-bg text-text-primary'
                        : 'bg-surface-primary text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSession(session.id)}
                      className="min-w-0 flex-1 px-4 py-3 text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center ${
                            isActive ? 'text-text-primary' : 'text-accent-data'
                          }`}
                          aria-hidden="true"
                        >
                          <MessageSquare size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{session.title}</span>
                            <span className="shrink-0 text-[10px] font-mono opacity-80">
                              {formatSessionTime(session.updatedAt)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs opacity-80">
                            {session.lastMessagePreview || 'No messages yet'}
                          </p>
                          <span className="mt-2 inline-block rounded bg-surface-base/40 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide opacity-80">
                            {session.messageCount} msg
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-start py-3 pr-3">
                      <button
                        type="button"
                        onClick={() => void handleDeleteSession(session)}
                        disabled={!isConnected || Boolean(deletingSessionId)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-border-default bg-surface-secondary text-text-muted opacity-100 transition-colors hover:border-accent-critical hover:text-accent-critical disabled:cursor-not-allowed disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                        title="Delete chat"
                        aria-label={`Delete ${session.title}`}
                      >
                        {isDeleting ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className={`${mobileView === 'conversation' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-surface-base md:flex`}>
        <header className="flex min-h-12 items-center gap-3 border-b-2 border-border-default bg-surface-primary px-4 py-3">
          <button
            type="button"
            onClick={() => setMobileView('sessions')}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border-default bg-surface-secondary text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary md:hidden"
            title="Back to sessions"
            aria-label="Back to sessions"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate text-base font-semibold text-text-primary">
              {activeSession?.title ?? 'New chat'}
            </h2>
            <span className="hidden h-1 w-1 shrink-0 rounded-full bg-text-muted sm:inline-block" aria-hidden="true" />
            <p className="hidden shrink-0 text-xs font-mono text-text-muted sm:block">
              {activeSession
                ? `${activeMessages.length} messages persisted in NormFS`
                : 'Messages will create a NormFS-backed session'}
            </p>
          </div>
          {error && (
            <div className="max-w-[42rem] truncate rounded border border-accent-critical bg-surface-secondary px-3 py-2 text-xs text-accent-critical">
              {error}
            </div>
          )}
        </header>

        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8"
        >
          {isLoadingMessages ? (
            <div className="flex h-full items-center justify-center text-sm font-mono text-text-muted">
              Loading chat history from NormFS...
            </div>
          ) : !isConnected && activeMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded border border-border-default bg-surface-primary">
                  <WifiOff size={22} className="text-accent-critical" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-text-primary">Station offline</h3>
                <p className="mt-2 text-sm text-text-secondary">Reconnect to load chat history.</p>
              </div>
            </div>
          ) : activeMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded border border-border-default bg-surface-primary">
                  <MessageSquare size={22} className="text-accent-data" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-text-primary">No messages</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  Send a text message to append it to this session history.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {messageGroups.map((group, groupIndex) => (
                <div key={group.key}>
                  {(groupIndex === 0 || messageGroups[groupIndex - 1].dateKey !== group.dateKey) && (
                    <div className="mb-4 flex justify-center">
                      <span className="rounded border border-border-default bg-surface-primary px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-text-muted">
                        {group.dateLabel}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col items-end gap-1.5">
                    {group.messages.map((message) => (
                      <div key={message.id} className="max-w-[min(42rem,86%)] rounded border border-accent-info bg-accent-info-bg px-4 py-3 text-text-primary shadow-sm">
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                        {message.saveState !== 'saved' && (
                          <div className={`mt-2 flex items-center justify-end gap-2 text-[10px] font-mono uppercase tracking-wide ${
                            message.saveState === 'failed' ? 'text-accent-critical' : 'text-text-secondary'
                          }`}>
                            {message.saveState === 'pending' ? (
                              <>
                                <Clock size={11} />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle size={11} />
                                <span>Failed</span>
                                <button
                                  type="button"
                                  onClick={() => handleRetryMessage(message)}
                                  disabled={!isConnected}
                                  className="inline-flex items-center gap-1 rounded border border-accent-critical px-1.5 py-0.5 text-[10px] text-accent-critical transition-colors hover:bg-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <RotateCcw size={10} />
                                  Retry
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-text-muted">
                      <span>{formatMessageTime(group.messages[group.messages.length - 1].createdAt)}</span>
                      {group.messages[group.messages.length - 1].saveState === 'saved' && (
                        <Check size={11} className="text-accent-success" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t-2 border-border-default bg-surface-primary p-3 md:p-4">
          <div className="mx-auto flex w-full max-w-4xl items-end gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={2}
              disabled={!isConnected}
              placeholder={isConnected ? 'Message' : 'Waiting for Station connection...'}
              className="max-h-36 min-h-12 flex-1 resize-none rounded border border-border-default bg-surface-secondary px-3 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-info disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!isConnected || draft.trim().length === 0}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded border border-accent-success bg-accent-success-bg text-text-primary transition-colors hover:bg-accent-success-deep disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-elevated disabled:text-text-muted"
              title="Send message (Ctrl/Cmd+Enter)"
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default ChatPage;
