export type AgentSessionMode = 'headless' | 'pty';
export type AgentSessionStatus = 'starting' | 'running' | 'stopped' | 'errored';
export type AgentRuntime = 'pi' | 'mock';

export interface AgentSession {
  id: string;
  name: string;
  mode: AgentSessionMode;
  runtime: AgentRuntime;
  status: AgentSessionStatus;
  cwd: string;
  provider: string;
  modelId: string;
  createdAtMs: number;
  updatedAtMs: number;
  piSessionFile?: string;
  piSessionId?: string;
  lastError?: string;
}

export interface AgentEventEnvelope {
  seq: number;
  atMs: number;
  event: Record<string, unknown>;
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export class AgentApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AgentApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const envelope = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!response.ok || !envelope.ok) {
    const error = envelope.ok
      ? { code: 'agent_api_error', message: `Agent API returned ${response.status}` }
      : envelope.error;
    throw new AgentApiError(error.code, error.message, response.status);
  }
  return envelope.data;
}

export const agentApi = {
  listSessions: () => request<AgentSession[]>('/api/sessions'),

  createSession: (name: string) =>
    request<AgentSession>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name,
        mode: 'headless',
        cwd: '.',
        provider: '',
        modelId: '',
      }),
    }),

  getSession: (id: string) => request<AgentSession>(`/api/sessions/${id}`),

  getEvents: (id: string, after: number) =>
    request<{ events: AgentEventEnvelope[] }>(
      `/api/sessions/${id}/events?after=${after}`,
    ),

  prompt: (id: string, message: string) =>
    request<{ accepted: boolean }>(`/api/sessions/${id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  steer: (id: string, message: string) =>
    request<{ accepted: boolean }>(`/api/sessions/${id}/steer`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  followUp: (id: string, message: string) =>
    request<{ accepted: boolean }>(`/api/sessions/${id}/follow-up`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  abort: (id: string) =>
    request<{ aborted: boolean }>(`/api/sessions/${id}/abort`, {
      method: 'POST',
    }),

  stop: (id: string) =>
    request<AgentSession>(`/api/sessions/${id}/stop`, { method: 'POST' }),

  resume: (id: string) =>
    request<AgentSession>(`/api/sessions/${id}/resume`, { method: 'POST' }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
};
