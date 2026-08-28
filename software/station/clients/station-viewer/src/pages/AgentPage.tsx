import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Bot, CircleStop, Play, Plus, Send, Trash2, Wrench } from 'lucide-react';
import {
  agentApi,
  type AgentEventEnvelope,
  type AgentSession,
} from '@/api/agent-api';

type ChatItem =
  | { id: string; kind: 'user'; text: string; atMs: number }
  | { id: string; kind: 'assistant'; text: string; atMs: number; streaming: boolean }
  | {
      id: string;
      kind: 'tool';
      name: string;
      detail: string;
      atMs: number;
      running: boolean;
    }
  | { id: string; kind: 'system'; text: string; atMs: number; tone: 'muted' | 'error' };

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => recordValue(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => part.type === 'text')
    .map((part) => textValue(part.text) ?? '')
    .join('');
}

function eventDelta(event: Record<string, unknown>): string | undefined {
  const direct = textValue(event.delta);
  if (direct) return direct;
  const nested = event.assistantMessageEvent;
  if (nested && typeof nested === 'object') {
    return textValue((nested as Record<string, unknown>).delta);
  }
  return undefined;
}

function findLastStreamingAssistant(items: ChatItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'assistant' && item.streaming) return index;
  }
  return -1;
}

function applyEvent(items: ChatItem[], envelope: AgentEventEnvelope): ChatItem[] {
  const event = envelope.event;
  const type = textValue(event.type);

  if (type === 'user_message') {
    return [
      ...items,
      {
        id: `user-${envelope.seq}`,
        kind: 'user',
        text: textValue(event.text) ?? '',
        atMs: envelope.atMs,
      },
    ];
  }

  if (type === 'message_start') {
    const message = recordValue(event.message);
    const role = textValue(message?.role);
    if (role === 'user' && message) {
      return [
        ...items,
        {
          id: `user-${envelope.seq}`,
          kind: 'user',
          text: messageText(message),
          atMs: envelope.atMs,
        },
      ];
    }
    if (role !== 'assistant') return items;
    const latest = items.at(-1);
    if (latest?.kind === 'assistant' && latest.streaming) return items;
    return [
      ...items,
      {
        id: `assistant-${envelope.seq}`,
        kind: 'assistant',
        text: '',
        atMs: envelope.atMs,
        streaming: true,
      },
    ];
  }

  if (type === 'message_update') {
    const delta = eventDelta(event);
    if (!delta) return items;
    const copy = [...items];
    const index = findLastStreamingAssistant(copy);
    if (index === -1) {
      return [
        ...copy,
        {
          id: `assistant-${envelope.seq}`,
          kind: 'assistant',
          text: delta,
          atMs: envelope.atMs,
          streaming: true,
        },
      ];
    }
    const item = copy[index];
    if (item.kind === 'assistant') {
      copy[index] = { ...item, text: item.text + delta };
    }
    return copy;
  }

  if (type === 'message_end') {
    const message = recordValue(event.message);
    if (textValue(message?.role) !== 'assistant') return items;
    const copy = [...items];
    const index = findLastStreamingAssistant(copy);
    const item = copy[index];
    if (item?.kind === 'assistant') {
      copy[index] = { ...item, streaming: false };
    }
    return copy;
  }

  if (type === 'tool_execution_start') {
    return [
      ...items,
      {
        id: textValue(event.toolCallId) ?? `tool-${envelope.seq}`,
        kind: 'tool',
        name: textValue(event.toolName) ?? 'tool',
        detail: JSON.stringify(event.args ?? {}, null, 2),
        atMs: envelope.atMs,
        running: true,
      },
    ];
  }

  if (type === 'tool_execution_end') {
    const id = textValue(event.toolCallId);
    const copy = [...items];
    const index = copy.findIndex((item) => item.kind === 'tool' && item.id === id);
    const item = copy[index];
    if (item?.kind === 'tool') {
      copy[index] = {
        ...item,
        detail: JSON.stringify(event.result ?? {}, null, 2),
        running: false,
      };
    }
    return copy;
  }

  if (type === 'agent_stderr') {
    return [
      ...items,
      {
        id: `stderr-${envelope.seq}`,
        kind: 'system',
        text: textValue(event.text) ?? 'Agent process wrote to stderr',
        atMs: envelope.atMs,
        tone: 'error',
      },
    ];
  }

  if (type === 'session_started' || type === 'session_stopped') {
    const backend = textValue(event.backend);
    return [
      ...items,
      {
        id: `system-${envelope.seq}`,
        kind: 'system',
        text:
          type === 'session_started'
            ? `Runtime connected${backend ? ` · ${backend}` : ''}`
            : 'Runtime stopped',
        atMs: envelope.atMs,
        tone: 'muted',
      },
    ];
  }

  return items;
}

function statusTone(status: AgentSession['status']): string {
  switch (status) {
    case 'running':
      return 'bg-accent-success';
    case 'starting':
      return 'bg-accent-warning';
    case 'errored':
      return 'bg-accent-critical';
    case 'stopped':
      return 'bg-text-muted';
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

const AgentPage: React.FC = () => {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streamingAction, setStreamingAction] = useState<'steer' | 'followUp'>('steer');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const cursorRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId),
    [selectedId, sessions],
  );

  const refreshSessions = useCallback(async () => {
    const next = await agentApi.listSessions();
    setSessions(next);
    setSelectedId((current) =>
      current && next.some((session) => session.id === current)
        ? current
        : next[0]?.id,
    );
  }, []);

  useEffect(() => {
    refreshSessions().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [refreshSessions]);

  useEffect(() => {
    cursorRef.current = 0;
    setItems([]);
    setStreaming(false);
    if (!selectedId) return;

    let active = true;
    let polling = false;
    let pollCount = 0;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const { events } = await agentApi.getEvents(selectedId, cursorRef.current);
        if (!active) return;
        if (events.length > 0) {
          cursorRef.current = events.at(-1)?.seq ?? cursorRef.current;
          setItems((current) => events.reduce(applyEvent, current));
          for (const envelope of events) {
            const type = textValue(envelope.event.type);
            if (type === 'agent_start') setStreaming(true);
            if (type === 'agent_settled') setStreaming(false);
          }
        }

        pollCount += 1;
        if (pollCount % 10 === 0) {
          const latest = await agentApi.getSession(selectedId);
          if (active) {
            setSessions((current) =>
              current.map((session) => (session.id === latest.id ? latest : session)),
            );
          }
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = window.setInterval(poll, 350);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items]);

  const createSession = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const session = await agentApi.createSession(`station-agent-${sessions.length + 1}`);
      await refreshSessions();
      setSelectedId(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const sendPrompt = async () => {
    const message = prompt.trim();
    if (!selected || !message) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!streaming) await agentApi.prompt(selected.id, message);
      if (streaming && streamingAction === 'steer') {
        await agentApi.steer(selected.id, message);
      }
      if (streaming && streamingAction === 'followUp') {
        await agentApi.followUp(selected.id, message);
      }
      setPrompt('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const abortTurn = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      await agentApi.abort(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const runLifecycleAction = async (action: 'stop' | 'resume' | 'delete') => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'stop') await agentApi.stop(selected.id);
      if (action === 'resume') await agentApi.resume(selected.id);
      if (action === 'delete') await agentApi.delete(selected.id);
      await refreshSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 bg-surface-base">
      <aside className="hidden w-72 shrink-0 border-r border-border-default bg-surface-primary lg:flex lg:flex-col">
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
              Agent sessions
            </p>
            <p className="mt-1 text-sm text-text-secondary">{sessions.length} local</p>
          </div>
          <button
            type="button"
            onClick={createSession}
            disabled={busy}
            className="rounded-md bg-accent-data p-2 text-surface-base transition-transform hover:scale-105 disabled:opacity-40"
            aria-label="Create agent session"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setSelectedId(session.id)}
              className={`group flex w-full items-center gap-3 border-l-2 px-5 py-3 text-left transition-colors ${
                session.id === selectedId
                  ? 'border-accent-data bg-surface-secondary'
                  : 'border-transparent hover:bg-surface-secondary/60'
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone(session.status)}`} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {session.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-text-muted">
                  {session.status} · {session.runtime}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-20 items-center gap-4 border-b border-border-default bg-surface-primary px-4 py-3 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-data/10 text-accent-data">
            <Bot size={21} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-text-primary">
                {selected?.name ?? 'Station agent'}
              </h1>
              {selected && (
                <span className={`h-2 w-2 rounded-full ${statusTone(selected.status)} ${streaming ? 'agent-status-pulse' : ''}`} />
              )}
            </div>
            <p className="truncate font-mono text-[11px] text-text-muted">
              {selected
                ? `${selected.provider || 'pi'}/${selected.modelId || 'default'} · ${selected.runtime} · ${selected.status}`
                : 'Create a local pi session'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!selected && (
              <button
                type="button"
                onClick={createSession}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-accent-data px-3 py-2 text-xs font-semibold text-surface-base transition-colors hover:bg-accent-data/80 disabled:opacity-40"
              >
                <Plus size={15} />
                New session
              </button>
            )}
            {selected?.status === 'running' && streaming && (
              <button
                type="button"
                onClick={abortTurn}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-accent-critical/60 px-3 py-2 text-xs text-accent-critical transition-colors hover:bg-accent-critical/10 disabled:opacity-40"
              >
                <Ban size={14} />
                Abort turn
              </button>
            )}
            {selected?.status === 'running' && (
              <button
                type="button"
                onClick={() => runLifecycleAction('stop')}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-border-default px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent-critical hover:text-accent-critical disabled:opacity-40"
              >
                <CircleStop size={14} />
                Stop
              </button>
            )}
            {selected && ['stopped', 'errored'].includes(selected.status) && (
              <button
                type="button"
                onClick={() => runLifecycleAction('resume')}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-accent-data px-3 py-2 text-xs font-semibold text-surface-base transition-colors hover:bg-accent-data/80 disabled:opacity-40"
              >
                <Play size={14} />
                Resume
              </button>
            )}
            {selected && selected.status !== 'running' && (
              <button
                type="button"
                onClick={() => runLifecycleAction('delete')}
                disabled={busy}
                className="rounded-md p-2 text-text-muted transition-colors hover:bg-surface-secondary hover:text-accent-critical disabled:opacity-40"
                aria-label="Delete session"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!selected ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-6 text-center">
              <Bot size={36} strokeWidth={1.25} className="text-accent-data" />
              <h2 className="mt-6 text-xl font-semibold text-text-primary">No agent session</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
                Create a headless session to exercise Station’s lifecycle, JSONL bridge,
                persistence, and chat flow.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-6 text-center">
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent-data">
                Runtime ready
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-text-primary">
                Ask the Station agent
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Station is connected to pi’s RPC mode. Provider and model use pi’s
                configured defaults unless specified for the session.
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
              {items.map((item) => {
                if (item.kind === 'system') {
                  return (
                    <div
                      key={item.id}
                      className={`agent-event-enter my-5 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] ${
                        item.tone === 'error' ? 'text-accent-critical' : 'text-text-muted'
                      }`}
                    >
                      <span className="h-px flex-1 bg-border-default" />
                      {item.text}
                      <span className="h-px flex-1 bg-border-default" />
                    </div>
                  );
                }
                if (item.kind === 'tool') {
                  return (
                    <div
                      key={item.id}
                      className="agent-event-enter my-5 ml-0 border-l-2 border-accent-data/60 bg-surface-primary px-4 py-3 sm:ml-12"
                    >
                      <div className="flex items-center gap-2">
                        <Wrench size={13} className="text-accent-data" />
                        <span className="font-mono text-xs font-semibold text-text-primary">
                          {item.name}
                        </span>
                        <span className="ml-auto font-mono text-[10px] uppercase text-text-muted">
                          {item.running ? 'running' : 'complete'}
                        </span>
                      </div>
                      <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-text-secondary">
                        {item.detail}
                      </pre>
                    </div>
                  );
                }
                const isUser = item.kind === 'user';
                return (
                  <article
                    key={item.id}
                    className={`agent-event-enter mb-8 ${isUser ? 'ml-auto max-w-2xl' : 'max-w-3xl'}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`text-xs font-semibold ${isUser ? 'text-accent-data' : 'text-text-primary'}`}>
                        {isUser ? 'You' : 'Agent'}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted">
                        {formatTime(item.atMs)}
                      </span>
                    </div>
                    <p className={`whitespace-pre-wrap text-sm leading-7 ${
                      isUser
                        ? 'border-l-2 border-accent-data bg-accent-data/5 px-4 py-3 text-text-primary'
                        : 'text-text-secondary'
                    }`}>
                      {item.text}
                      {item.kind === 'assistant' && item.streaming && (
                        <span className="ml-1 inline-block h-4 w-1 bg-accent-data align-middle agent-status-pulse" />
                      )}
                    </p>
                  </article>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className="border-t border-border-default bg-surface-primary px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-4xl">
            {error && (
              <p role="alert" className="mb-3 text-xs text-accent-critical">
                {error}
              </p>
            )}
            {streaming && (
              <div className="mb-3 flex items-center gap-2 text-xs">
                <span className="text-text-muted">This message will</span>
                <button
                  type="button"
                  onClick={() => setStreamingAction('steer')}
                  className={`rounded px-2 py-1 ${
                    streamingAction === 'steer'
                      ? 'bg-accent-data/15 text-accent-data'
                      : 'text-text-secondary hover:bg-surface-secondary'
                  }`}
                >
                  steer now
                </button>
                <button
                  type="button"
                  onClick={() => setStreamingAction('followUp')}
                  className={`rounded px-2 py-1 ${
                    streamingAction === 'followUp'
                      ? 'bg-accent-data/15 text-accent-data'
                      : 'text-text-secondary hover:bg-surface-secondary'
                  }`}
                >
                  run next
                </button>
              </div>
            )}
            <div className="flex items-end gap-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendPrompt();
                  }
                }}
                rows={2}
                disabled={!selected || selected.status !== 'running' || busy}
                placeholder={
                  selected?.status === 'running'
                    ? 'Prompt the agent…'
                    : 'Start or resume a session to send a prompt'
                }
                className="min-h-12 flex-1 resize-none border-0 border-b border-border-default bg-transparent px-1 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-data disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendPrompt}
                disabled={
                  !selected ||
                  selected.status !== 'running' ||
                  !prompt.trim() ||
                  busy
                }
                className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent-data text-surface-base transition-transform hover:scale-105 disabled:scale-100 disabled:opacity-30"
                aria-label="Send prompt"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] text-text-muted">
              pi RPC · persisted native session · event polling
              {selected?.piSessionId ? ` · ${selected.piSessionId}` : ''}
            </p>
          </div>
        </footer>
      </section>
    </main>
  );
};

export default AgentPage;
