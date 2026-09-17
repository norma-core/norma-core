import { ChevronLeft } from 'lucide-react';
import type { ChatSession, MobileView } from '../types';

interface ChatConversationHeaderProps {
  activeSession: ChatSession | null;
  activeMessagesLength: number;
  error: string | null;
  onMobileViewChange: (view: MobileView) => void;
}

function ChatConversationHeader({
  activeSession,
  activeMessagesLength,
  error,
  onMobileViewChange,
}: ChatConversationHeaderProps) {
  return (
    <header className="flex min-h-12 items-center gap-3 border-b-2 border-border-default bg-surface-primary px-4 py-3">
      <button
        type="button"
        onClick={() => onMobileViewChange('sessions')}
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
            ? `${activeMessagesLength} ${activeMessagesLength === 1 ? 'message' : 'messages'}`
            : 'Start typing to begin a new chat'}
        </p>
      </div>
      {error && (
        <div className="max-w-[42rem] truncate rounded border border-accent-critical bg-surface-secondary px-3 py-2 text-xs text-accent-critical">
          {error}
        </div>
      )}
    </header>
  );
}

export default ChatConversationHeader;
