import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';
import {
  createChatSession,
  createUserMessage,
  deleteChatSession,
  loadChatMessagesBefore,
  loadRecentChatMessages,
  loadChatSessions,
  saveChatMessage,
  saveChatSessionCreated,
  saveChatSessionUpdated,
} from '@/api/chat-store';
import type { ConnectionStats } from '@/api/websocket';
import { useConnectionStats } from '@/hooks';
import {
  buildSessionTitle,
  errorMessage,
  fallbackSessionFromMessage,
  summarizeSession,
  upsertSession,
} from './chat-format';
import { groupMessages } from './message-groups';
import { EMPTY_MESSAGE_PAGING, mergeMessagePaging } from './message-paging';
import { mergeMessageViews, updateMessageSaveState, withSavedState } from './message-state';
import { useChatScroll } from './useChatScroll';
import type {
  ChatMessage,
  ChatMessagePage,
  ChatMessagePagingState,
  ChatMessageView,
  ChatScrollSnapshot,
  ChatSession,
  MessageSaveState,
  MobileView,
  SessionSaveMode,
} from './types';

function pagingFromPage(page: ChatMessagePage): ChatMessagePagingState {
  return {
    oldestEntryId: page.oldestEntryId,
    hasMoreBefore: page.hasMoreBefore,
  };
}

export interface ChatController {
  connectionStats: ConnectionStats | null;
  isConnected: boolean;
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  activeMessages: ChatMessageView[];
  messageGroups: ReturnType<typeof groupMessages>;
  filteredSessions: ChatSession[];
  draft: string;
  setDraft: (draft: string) => void;
  sessionQuery: string;
  setSessionQuery: (query: string) => void;
  mobileView: MobileView;
  setMobileView: (view: MobileView) => void;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  hasMoreMessagesBefore: boolean;
  isCreatingSession: boolean;
  deletingSessionId: string | null;
  error: string | null;
  showScrollToBottom: boolean;
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  reloadSessions: () => Promise<void>;
  handleCreateSession: () => Promise<void>;
  handleDeleteSession: (session: ChatSession) => Promise<void>;
  handleSelectSession: (sessionId: string) => void;
  handleMessagesScroll: () => void;
  handleScrollToBottom: () => void;
  handleRetryMessage: (message: ChatMessageView) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useChatController(): ChatController {
  const connectionStats = useConnectionStats();
  const isConnected = connectionStats?.status === 'connected';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessageView[]>>({});
  const [messagePagingBySession, setMessagePagingBySession] = useState<Record<string, ChatMessagePagingState>>({});
  const [draft, setDraft] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [mobileView, setMobileView] = useState<MobileView>('sessions');
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [loadingOlderSessionId, setLoadingOlderSessionId] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef('');
  const activeSessionIdRef = useRef<string | null>(null);
  const deletedSessionIdsRef = useRef(new Set<string>());
  const loadingOlderSessionIdsRef = useRef(new Set<string>());

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeMessages = useMemo(
    () => activeSessionId ? messagesBySession[activeSessionId] ?? [] : [],
    [activeSessionId, messagesBySession],
  );
  const activeMessagePaging = useMemo(
    () => activeSessionId ? messagePagingBySession[activeSessionId] ?? EMPTY_MESSAGE_PAGING : EMPTY_MESSAGE_PAGING,
    [activeSessionId, messagePagingBySession],
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

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

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
        [sessionId]: updateMessageSaveState(sessionMessages, messageId, saveState, saveError),
      };
    });
  }, []);

  const persistMessage = useCallback(async (
    session: ChatSession,
    message: ChatMessage,
    sessionMessages: ChatMessageView[],
    sessionSaveMode: SessionSaveMode,
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
      if (sessionSaveMode === 'create') {
        await saveChatSessionCreated(nextSession);
      } else {
        await saveChatSessionUpdated(nextSession);
      }
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

    loadRecentChatMessages(activeSessionId)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setMessagesBySession((current) => {
          const currentMessages = current[activeSessionId] ?? [];
          return {
            ...current,
            [activeSessionId]: mergeMessageViews(currentMessages, withSavedState(page.messages)),
          };
        });
        setMessagePagingBySession((current) => ({
          ...current,
          [activeSessionId]: mergeMessagePaging(current[activeSessionId], pagingFromPage(page)),
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

  const loadOlderMessages = useCallback(async (snapshot: ChatScrollSnapshot) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || !isConnected || loadingOlderSessionIdsRef.current.has(sessionId)) {
      return;
    }

    const paging = messagePagingBySession[sessionId] ?? EMPTY_MESSAGE_PAGING;
    if (!paging.hasMoreBefore || !paging.oldestEntryId) {
      return;
    }

    loadingOlderSessionIdsRef.current.add(sessionId);
    setLoadingOlderSessionId(sessionId);
    setError(null);

    try {
      const page = await loadChatMessagesBefore(sessionId, paging.oldestEntryId);
      setMessagesBySession((current) => {
        const currentMessages = current[sessionId] ?? [];
        return {
          ...current,
          [sessionId]: mergeMessageViews(currentMessages, withSavedState(page.messages)),
        };
      });
      setMessagePagingBySession((current) => {
        const incomingPaging = page.oldestEntryId
          ? pagingFromPage(page)
          : { oldestEntryId: current[sessionId]?.oldestEntryId ?? null, hasMoreBefore: false };

        return {
          ...current,
          [sessionId]: mergeMessagePaging(current[sessionId], incomingPaging),
        };
      });

      if (activeSessionIdRef.current === sessionId) {
        snapshot.restore();
      }
    } catch (err) {
      console.error('Failed to load earlier chat messages:', err);
      setError(`Failed to load earlier messages: ${errorMessage(err)}`);
    } finally {
      loadingOlderSessionIdsRef.current.delete(sessionId);
      setLoadingOlderSessionId((current) => current === sessionId ? null : current);
    }
  }, [isConnected, messagePagingBySession]);

  const {
    messagesScrollRef,
    messagesEndRef,
    showScrollToBottom,
    handleMessagesScroll,
    handleScrollToBottom,
  } = useChatScroll({
    activeSessionId,
    activeMessagesLength: activeMessages.length,
    isLoadingMessages,
    onLoadOlderMessages: loadOlderMessages,
  });

  const handleCreateSession = useCallback(async () => {
    if (!isConnected || isCreatingSession) {
      return;
    }

    setIsCreatingSession(true);
    setError(null);
    try {
      const session = createChatSession();
      await saveChatSessionCreated(session);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setMessagesBySession((current) => ({ ...current, [session.id]: [] }));
      setMessagePagingBySession((current) => ({ ...current, [session.id]: EMPTY_MESSAGE_PAGING }));
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
      setMessagePagingBySession((current) => {
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
    let sessionSaveMode: SessionSaveMode = 'update';
    const existingMessages = session ? messagesBySession[session.id] ?? [] : [];

    if (!session) {
      session = createChatSession(buildSessionTitle(text));
      sessionSaveMode = 'create';
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
    setMessagePagingBySession((current) => (
      current[nextSession.id] ? current : { ...current, [nextSession.id]: EMPTY_MESSAGE_PAGING }
    ));
    setSessions((current) => upsertSession(current, nextSession));
    setActiveSessionId(nextSession.id);
    setMobileView('conversation');

    void persistMessage(nextSession, message, nextMessages, sessionSaveMode);
  }, [activeSession, isConnected, messagesBySession, persistMessage]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setMobileView('conversation');
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
    void persistMessage(nextSession, retryMessage, sessionMessages, 'update');
  }, [isConnected, markMessageSaveState, messagesBySession, persistMessage, sessions]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage();
  }, [submitMessage]);

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submitMessage();
    }
  }, [submitMessage]);

  return {
    connectionStats,
    isConnected,
    sessions,
    activeSession,
    activeSessionId,
    activeMessages,
    messageGroups,
    filteredSessions,
    draft,
    setDraft,
    sessionQuery,
    setSessionQuery,
    mobileView,
    setMobileView,
    isLoadingSessions,
    isLoadingMessages,
    isLoadingOlderMessages: Boolean(activeSessionId && loadingOlderSessionId === activeSessionId),
    hasMoreMessagesBefore: activeMessagePaging.hasMoreBefore,
    isCreatingSession,
    deletingSessionId,
    error,
    showScrollToBottom,
    messagesScrollRef,
    messagesEndRef,
    reloadSessions,
    handleCreateSession,
    handleDeleteSession,
    handleSelectSession,
    handleMessagesScroll,
    handleScrollToBottom,
    handleRetryMessage,
    handleSubmit,
    handleComposerKeyDown,
  };
}
