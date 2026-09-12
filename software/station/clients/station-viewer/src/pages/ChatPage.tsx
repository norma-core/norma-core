import ChatComposer from '@/chat/components/ChatComposer';
import ChatConversationHeader from '@/chat/components/ChatConversationHeader';
import ChatMessageList from '@/chat/components/ChatMessageList';
import ChatSessionRail from '@/chat/components/ChatSessionRail';
import { useChatController } from '@/chat/useChatController';

function ChatPage() {
  const chat = useChatController();

  return (
    <div className="flex-1 min-h-0 flex bg-surface-base text-text-primary">
      <ChatSessionRail
        mobileView={chat.mobileView}
        connectionStats={chat.connectionStats}
        isConnected={chat.isConnected}
        sessions={chat.sessions}
        filteredSessions={chat.filteredSessions}
        activeSessionId={chat.activeSessionId}
        sessionQuery={chat.sessionQuery}
        isLoadingSessions={chat.isLoadingSessions}
        isCreatingSession={chat.isCreatingSession}
        deletingSessionId={chat.deletingSessionId}
        onSessionQueryChange={chat.setSessionQuery}
        onReloadSessions={chat.reloadSessions}
        onCreateSession={chat.handleCreateSession}
        onSelectSession={chat.handleSelectSession}
        onDeleteSession={chat.handleDeleteSession}
      />

      <main className={`${chat.mobileView === 'conversation' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-surface-base md:flex`}>
        <ChatConversationHeader
          activeSession={chat.activeSession}
          activeMessagesLength={chat.activeMessages.length}
          error={chat.error}
          onMobileViewChange={chat.setMobileView}
        />

        <ChatMessageList
          messagesScrollRef={chat.messagesScrollRef}
          messagesEndRef={chat.messagesEndRef}
          isLoadingMessages={chat.isLoadingMessages}
          isLoadingOlderMessages={chat.isLoadingOlderMessages}
          hasMoreMessagesBefore={chat.hasMoreMessagesBefore}
          isConnected={chat.isConnected}
          activeMessages={chat.activeMessages}
          messageGroups={chat.messageGroups}
          onMessagesScroll={chat.handleMessagesScroll}
          onRetryMessage={chat.handleRetryMessage}
        />

        <ChatComposer
          draft={chat.draft}
          isConnected={chat.isConnected}
          activeMessagesLength={chat.activeMessages.length}
          showScrollToBottom={chat.showScrollToBottom}
          onDraftChange={chat.setDraft}
          onSubmit={chat.handleSubmit}
          onComposerKeyDown={chat.handleComposerKeyDown}
          onScrollToBottom={chat.handleScrollToBottom}
        />
      </main>
    </div>
  );
}

export default ChatPage;
