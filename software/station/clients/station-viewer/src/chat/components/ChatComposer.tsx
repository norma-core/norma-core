import type { FormEvent, KeyboardEvent } from 'react';
import { ChevronDown, CornerDownLeft, Send } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
const SEND_HINT = isMac ? '⌘⏎ to send' : 'Ctrl+⏎ to send';

interface ChatComposerProps {
  draft: string;
  isConnected: boolean;
  activeMessagesLength: number;
  showScrollToBottom: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScrollToBottom: () => void;
}

function ChatComposer({
  draft,
  isConnected,
  activeMessagesLength,
  showScrollToBottom,
  onDraftChange,
  onSubmit,
  onComposerKeyDown,
  onScrollToBottom,
}: ChatComposerProps) {
  return (
    <form onSubmit={onSubmit} className="relative border-t-2 border-border-default bg-surface-primary p-3 md:p-4">
      {showScrollToBottom && activeMessagesLength > 0 && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="absolute -top-12 right-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-default bg-surface-secondary text-text-secondary shadow-lg transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          title="Scroll to latest"
          aria-label="Scroll to latest message"
        >
          <ChevronDown size={16} />
        </button>
      )}
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={1}
            disabled={!isConnected}
            placeholder={isConnected ? 'Message...' : 'Waiting for Station connection...'}
            className="field-sizing-content max-h-36 min-h-10 flex-1 resize-none rounded border border-border-default bg-surface-secondary px-3 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-info disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!isConnected || draft.trim().length === 0}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border-default bg-surface-secondary text-accent-success transition-colors hover:border-accent-success hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-40 disabled:hover:border-border-default disabled:hover:bg-surface-secondary"
            title="Send message (Ctrl/Cmd+Enter)"
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] font-mono text-text-muted">
          <CornerDownLeft size={10} />
          <span>{SEND_HINT}</span>
        </div>
      </div>
    </form>
  );
}

export default ChatComposer;
