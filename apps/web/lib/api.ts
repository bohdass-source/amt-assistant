'use client';

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  url: string;
  page: number;
  section: string | null;
  docDate: string;
  dateNote: string | null;
  snippet: string;
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
  guest: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  footer: string | null;
  refused: boolean;
  rating: number | null;
}

export type ChatEvent =
  | { event: 'meta'; data: { conversationId: string; userMessageId: string; lang: string; queryDe: string } }
  | { event: 'sources'; data: { fragments: Citation[] } }
  | { event: 'token'; data: { text: string } }
  | {
      event: 'done';
      data: { messageId: string; answer: string; citations: Citation[]; footer: string; refused: boolean; refusalReason: string | null };
    }
  | { event: 'error'; data: { message: string } };

const TOKEN_KEY = 'amt.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = typeof body.message === 'string' ? body.message : JSON.stringify(body.message ?? body);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Гость получает анонимную учётку при первом визите — так работают история и оценки. */
export async function ensureSession(): Promise<SessionUser> {
  if (getToken()) {
    try {
      return await api<SessionUser>('/auth/me');
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      setToken(null);
    }
  }
  const s = await api<{ token: string; user: SessionUser }>('/auth/guest', { method: 'POST' });
  setToken(s.token);
  return s.user;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const s = await api<{ token: string; user: SessionUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(s.token);
  return s.user;
}

/** POST + Server-Sent Events: EventSource умеет только GET, поэтому читаем поток вручную. */
export async function streamChat(
  body: { conversationId?: string; message: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, `chat HTTP ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) onEvent({ event, data: JSON.parse(data) } as ChatEvent);
    }
  }
}
