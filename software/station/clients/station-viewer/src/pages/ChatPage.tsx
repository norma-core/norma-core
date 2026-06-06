import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Plus, RefreshCw, Send, Wifi, WifiOff } from 'lucide-react';
import {
  ChatMessage,
  ChatSession,
  createChatSession,
  createUserMessage,
  loadChatMessages,
  loadChatSessions,
  saveChatMessage,
  saveChatSession,
} from '@/api/chat-store';
import { useConnectionStats } from '@/hooks';

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

function ChatPage() {
  const connectionStats = useConnectionStats();
  const isConnected = connectionStats?.status === 'connected';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState('');
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeMessages = activeSessionId ? messagesBySession[activeSessionId] ?? [] : [];

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
          [activeSessionId]: messages,
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
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
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
    } catch (err) {
      console.error('Failed to create chat session:', err);
      setError(`Failed to create chat session: ${errorMessage(err)}`);
    } finally {
      setIsCreatingSession(false);
    }
  }, [isConnected, isCreatingSession]);

  const submitMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || !isConnected || isSending) {
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      let session = activeSession;
      const existingMessages = session ? messagesBySession[session.id] ?? [] : [];

      if (!session) {
        session = createChatSession(buildSessionTitle(text));
        await saveChatSession(session);
        setActiveSessionId(session.id);
      }

      const message = createUserMessage(session.id, text);
      await saveChatMessage(message);

      const nextMessages = [...existingMessages, message];
      const nextSession: ChatSession = {
        ...session,
        title: existingMessages.length === 0 ? buildSessionTitle(text) : session.title,
        updatedAt: message.createdAt,
        lastMessagePreview: text,
        messageCount: nextMessages.length,
      };

      await saveChatSession(nextSession);

      setDraft('');
      setMessagesBySession((current) => ({
        ...current,
        [nextSession.id]: nextMessages,
      }));
      setSessions((current) => [
        nextSession,
        ...current.filter((item) => item.id !== nextSession.id),
      ]);
      setActiveSessionId(nextSession.id);
    } catch (err) {
      console.error('Failed to save chat message:', err);
      setError(`Failed to save message via NormFS: ${errorMessage(err)}`);
    } finally {
      setIsSending(false);
    }
  }, [activeSession, draft, isConnected, isSending, messagesBySession]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface-base text-text-primary md:flex-row">
      <aside className="flex h-64 shrink-0 flex-col border-b-2 border-border-default bg-surface-primary md:h-auto md:w-80 md:border-b-0 md:border-r-2">
        <div className="flex items-center gap-3 border-b border-border-default px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-border-default bg-surface-secondary">
            <MessageSquare size={18} className="text-accent-data" />
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
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border-default bg-surface-secondary text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh sessions"
            aria-label="Refresh sessions"
          >
            <RefreshCw size={15} className={isLoadingSessions ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            disabled={!isConnected || isCreatingSession}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-accent-success bg-accent-success-bg text-text-primary transition-colors hover:bg-accent-success-deep disabled:cursor-not-allowed disabled:opacity-50"
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoadingSessions ? (
            <div className="px-4 py-5 text-xs font-mono text-text-muted">Loading sessions from NormFS...</div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-5 text-sm text-text-secondary">
              <p>No chat sessions yet.</p>
              <button
                type="button"
                onClick={() => void handleCreateSession()}
                disabled={!isConnected || isCreatingSession}
                className="mt-3 inline-flex items-center gap-2 rounded border border-border-default bg-surface-secondary px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-primary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} />
                New chat
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setActiveSessionId(session.id)}
                    className={`block w-full px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'bg-accent-info-bg text-text-primary'
                        : 'bg-surface-primary text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
                        isActive ? 'border-text-primary/40 bg-text-primary/10' : 'border-border-default bg-surface-secondary'
                      }`}>
                        <MessageSquare size={15} />
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
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-surface-base">
        <header className="flex min-h-12 items-center gap-3 border-b-2 border-border-default bg-surface-primary px-4 py-3">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
          {isLoadingMessages ? (
            <div className="flex h-full items-center justify-center text-sm font-mono text-text-muted">
              Loading chat history from NormFS...
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
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
              {activeMessages.map((message) => (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[min(42rem,86%)] rounded border border-accent-info bg-accent-info-bg px-4 py-3 text-text-primary shadow-sm">
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                    <div className="mt-2 text-right text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                      {formatMessageTime(message.createdAt)}
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
              disabled={!isConnected || isSending}
              placeholder={isConnected ? 'Message' : 'Waiting for Station connection...'}
              className="max-h-36 min-h-12 flex-1 resize-none rounded border border-border-default bg-surface-secondary px-3 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-info disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!isConnected || isSending || draft.trim().length === 0}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded border border-accent-success bg-accent-success-bg text-text-primary transition-colors hover:bg-accent-success-deep disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-elevated disabled:text-text-muted"
              title="Send message"
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
