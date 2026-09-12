import { MessageSquare, Plus, RefreshCw, Search, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { ConnectionStats } from '@/api/websocket';
import { formatFullTimestamp, formatSessionTime } from '../chat-format';
import type { ChatSession, MobileView } from '../types';

const HEADER_ACTION_BUTTON_CLASS = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border';

interface ChatSessionRailProps {
  mobileView: MobileView;
  connectionStats: ConnectionStats | null;
  isConnected: boolean;
  sessions: ChatSession[];
  filteredSessions: ChatSession[];
  activeSessionId: string | null;
  sessionQuery: string;
  isLoadingSessions: boolean;
  isCreatingSession: boolean;
  deletingSessionId: string | null;
  onSessionQueryChange: (query: string) => void;
  onReloadSessions: () => Promise<void>;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (session: ChatSession) => Promise<void>;
}

function ChatSessionRail({
  mobileView,
  connectionStats,
  isConnected,
  sessions,
  filteredSessions,
  activeSessionId,
  sessionQuery,
  isLoadingSessions,
  isCreatingSession,
  deletingSessionId,
  onSessionQueryChange,
  onReloadSessions,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}: ChatSessionRailProps) {
  return (
    <aside className={`${mobileView === 'sessions' ? 'flex' : 'hidden'} min-h-0 w-full shrink-0 flex-col bg-surface-primary md:flex md:w-80 md:border-r-2 md:border-border-default`}>
      <div className="flex items-center gap-2 border-b border-border-default px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-sm font-semibold uppercase tracking-wide text-text-primary">Chat</h1>
          <span
            className="flex shrink-0 items-center gap-1 rounded border border-border-default bg-surface-secondary px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-muted"
            title={connectionStats?.status ?? 'connecting'}
          >
            {isConnected ? (
              <Wifi size={10} className="text-accent-success" />
            ) : (
              <WifiOff size={10} className="text-accent-critical" />
            )}
            <span>{isConnected ? 'online' : 'offline'}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onReloadSessions()}
          disabled={!isConnected || isLoadingSessions}
          className={`${HEADER_ACTION_BUTTON_CLASS} border-border-default bg-surface-secondary text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50`}
          title="Refresh sessions"
          aria-label="Refresh sessions"
        >
          <RefreshCw size={14} className={isLoadingSessions ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => void onCreateSession()}
          disabled={!isConnected || isCreatingSession}
          className={`${HEADER_ACTION_BUTTON_CLASS} border-accent-success bg-accent-success-bg text-text-primary transition-colors hover:bg-accent-success-deep disabled:cursor-not-allowed disabled:opacity-50`}
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="border-b border-border-default px-4 py-3">
        <label className="flex h-9 items-center gap-2 rounded border border-border-default bg-surface-secondary px-3 text-sm text-text-secondary focus-within:border-accent-info">
          <Search size={14} className="shrink-0 text-text-muted" />
          <input
            type="search"
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
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
          <div className="px-4 py-5 text-xs font-mono text-text-muted">Loading sessions...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-text-secondary">
            <MessageSquare size={24} className="mb-3 text-accent-data" />
            <p className="font-semibold text-text-primary">
              {sessionQuery.trim() ? 'No matches' : 'No sessions'}
            </p>
            <p className="mt-1">
              {sessionQuery.trim() ? 'Try a different search term.' : 'Click + to start a new chat.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {filteredSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isDeleting = deletingSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={`group flex items-stretch border-l-2 transition-colors ${
                    isActive
                      ? 'border-accent-info bg-surface-secondary text-text-primary'
                      : 'border-transparent bg-surface-primary text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>
                        {session.title}
                      </span>
                      <span
                        className="shrink-0 text-[10px] font-mono text-text-muted"
                        title={formatFullTimestamp(session.updatedAt)}
                      >
                        {formatSessionTime(session.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {session.lastMessagePreview || 'No messages yet'}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => void onDeleteSession(session)}
                      disabled={!isConnected || Boolean(deletingSessionId)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted opacity-100 transition-colors hover:bg-surface-tertiary hover:text-accent-critical disabled:cursor-not-allowed disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                      title="Delete chat"
                      aria-label={`Delete ${session.title}`}
                    >
                      {isDeleting ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
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
  );
}

export default ChatSessionRail;
