import type { RefObject } from 'react';
import { AlertCircle, Clock, MessageSquare, RotateCcw, WifiOff } from 'lucide-react';
import { formatFullTimestamp, formatMessageTime } from '../chat-format';
import type { ChatMessageView, MessageGroup } from '../types';

interface ChatMessageListProps {
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  hasMoreMessagesBefore: boolean;
  isConnected: boolean;
  activeMessages: ChatMessageView[];
  messageGroups: MessageGroup[];
  onMessagesScroll: () => void;
  onRetryMessage: (message: ChatMessageView) => void;
}

function ChatMessageList({
  messagesScrollRef,
  messagesEndRef,
  isLoadingMessages,
  isLoadingOlderMessages,
  hasMoreMessagesBefore,
  isConnected,
  activeMessages,
  messageGroups,
  onMessagesScroll,
  onRetryMessage,
}: ChatMessageListProps) {
  return (
    <div
      ref={messagesScrollRef}
      onScroll={onMessagesScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8"
    >
      {isLoadingMessages ? (
        <div className="flex h-full items-center justify-center text-sm font-mono text-text-muted">
          Loading messages...
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
              Send a message to start the conversation.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {(isLoadingOlderMessages || hasMoreMessagesBefore) && (
            <div className="flex justify-center">
              <span className="rounded border border-border-default bg-surface-primary px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-text-muted">
                {isLoadingOlderMessages ? 'Loading earlier...' : 'Scroll up for earlier'}
              </span>
            </div>
          )}
          {messageGroups.map((group, groupIndex) => (
            <div key={group.key}>
              {(groupIndex === 0 || messageGroups[groupIndex - 1].dateKey !== group.dateKey) && (
                <div className="mb-4 flex justify-center">
                  <span className="rounded border border-border-default bg-surface-primary px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-text-muted">
                    {group.dateLabel}
                  </span>
                </div>
              )}
              <div className="flex flex-col items-end gap-1">
                {group.messages.map((message, messageIndex) => {
                  const isLast = messageIndex === group.messages.length - 1;
                  return (
                    <div
                      key={message.id}
                      className="max-w-[min(42rem,86%)] rounded-lg border border-accent-info/40 bg-accent-info-bg px-4 py-2.5 text-text-primary shadow-sm"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] font-mono text-text-primary/70">
                        {message.saveState === 'failed' ? (
                          <>
                            <AlertCircle size={11} className="text-accent-critical" />
                            <span className="text-accent-critical">Failed</span>
                            <button
                              type="button"
                              onClick={() => onRetryMessage(message)}
                              disabled={!isConnected}
                              className="inline-flex items-center gap-1 rounded border border-accent-critical px-1.5 py-0.5 text-accent-critical transition-colors hover:bg-surface-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCcw size={10} />
                              Retry
                            </button>
                          </>
                        ) : message.saveState === 'pending' ? (
                          <>
                            <Clock size={10} className="opacity-80" />
                            <span>Saving</span>
                          </>
                        ) : isLast ? (
                          <span title={formatFullTimestamp(message.createdAt)}>
                            {formatMessageTime(message.createdAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}

export default ChatMessageList;
