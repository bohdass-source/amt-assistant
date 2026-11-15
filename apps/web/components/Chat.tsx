'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, ensureSession, streamChat, type Citation, type ConversationSummary, type StoredMessage } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { AnswerText } from './AnswerText';
import { SourcesPanel } from './SourcesPanel';

interface UiMessage {
  key: string;
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  /** Все фрагменты, переданные модели (пока идёт стрим), затем — только процитированные. */
  citations: Citation[];
  footer: string | null;
  refused: boolean;
  rating: number | null;
  pending?: boolean;
  error?: boolean;
}

const fromStored = (m: StoredMessage): UiMessage => ({
  key: m.id,
  id: m.id,
  role: m.role,
  content: m.content,
  citations: m.citations ?? [],
  footer: m.footer,
  refused: m.refused,
  rating: m.rating ?? null,
});

export function Chat() {
  const { t } = useLang();
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    setConversations(await api<ConversationSummary[]>('/conversations'));
  }, []);

  useEffect(() => {
    ensureSession()
      .then(loadConversations)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const openConversation = async (id: string) => {
    abortRef.current?.abort();
    const rows = await api<StoredMessage[]>(`/conversations/${id}`);
    const ui = rows.map(fromStored);
    setConversationId(id);
    setMessages(ui);
    setSelected(ui.filter((m) => m.role === 'assistant').at(-1)?.key ?? null);
    setActiveCite(null);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setConversationId(undefined);
    setMessages([]);
    setSelected(null);
    setActiveCite(null);
  };

  const deleteConversation = async (id: string) => {
    await api(`/conversations/${id}`, { method: 'DELETE' });
    if (id === conversationId) newChat();
    await loadConversations();
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const userKey = `u-${Date.now()}`;
    const botKey = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { key: userKey, role: 'user', content: message, citations: [], footer: null, refused: false, rating: null },
      { key: botKey, role: 'assistant', content: '', citations: [], footer: null, refused: false, rating: null, pending: true },
    ]);
    setSelected(botKey);
    setActiveCite(null);

    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((all) => all.map((m) => (m.key === botKey ? fn(m) : m)));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        { conversationId, message },
        (e) => {
          if (e.event === 'meta') setConversationId(e.data.conversationId);
          else if (e.event === 'sources') patch((m) => ({ ...m, citations: e.data.fragments }));
          else if (e.event === 'token') patch((m) => ({ ...m, content: m.content + e.data.text }));
          else if (e.event === 'done')
            patch((m) => ({
              ...m,
              id: e.data.messageId,
              // Сервер заменяет стрим проверенным текстом: невалидные сноски уже удалены.
              content: e.data.answer,
              citations: e.data.citations,
              footer: e.data.footer,
              refused: e.data.refused,
              pending: false,
            }));
          else if (e.event === 'error') patch((m) => ({ ...m, pending: false, error: true }));
        },
        controller.signal,
      );
      await loadConversations();
    } catch {
      if (!controller.signal.aborted) patch((m) => ({ ...m, pending: false, error: true }));
      else patch((m) => ({ ...m, pending: false }));
    } finally {
      setBusy(false);
    }
  };

  const rate = async (m: UiMessage, score: 1 | -1) => {
    if (!m.id) return;
    await api(`/messages/${m.id}/rating`, { method: 'POST', body: JSON.stringify({ score }) });
    setMessages((all) => all.map((x) => (x.key === m.key ? { ...x, rating: score } : x)));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const selectedMessage = messages.find((m) => m.key === selected);

  return (
    <div className="chat-layout">
      <nav className="history" aria-label={t.history}>
        <button type="button" className="btn btn-primary btn-block" onClick={newChat}>
          + {t.newChat}
        </button>
        <h2>{t.history}</h2>
        {conversations.length === 0 ? (
          <p className="muted small">{t.noHistory}</p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id} className={c.id === conversationId ? 'current' : undefined}>
                <button type="button" className="history-item" onClick={() => void openConversation(c.id)}>
                  {c.title}
                </button>
                <button type="button" className="icon-btn" aria-label={t.deleteChat} title={t.deleteChat} onClick={() => void deleteConversation(c.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <section className="conversation">
        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="welcome">
              <h1>{t.welcomeTitle}</h1>
              <p>{t.welcomeText}</p>
              <div className="examples">
                {t.examples.map((q) => (
                  <button key={q} type="button" className="example" disabled={!ready} onClick={() => void send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.key} className="msg msg-user">
                {m.content}
              </div>
            ) : (
              <article
                key={m.key}
                className={`msg msg-bot${selected === m.key ? ' selected' : ''}${m.refused ? ' refused' : ''}`}
                onClick={() => setSelected(m.key)}
              >
                {m.pending && !m.content ? <p className="muted typing">{t.searching}</p> : null}
                {m.error ? <p className="error">{t.error}</p> : null}
                {m.content ? (
                  <AnswerText
                    text={m.content}
                    citable={new Set(m.citations.map((c) => c.n))}
                    onCite={(n) => {
                      setSelected(m.key);
                      setActiveCite(n);
                    }}
                  />
                ) : null}
                {m.footer ? <p className="answer-footer">{m.footer}</p> : null}
                {!m.pending && m.id ? (
                  <div className="rating" role="group">
                    {m.rating ? <span className="muted small">{t.thanks}</span> : null}
                    <button type="button" className="icon-btn" aria-pressed={m.rating === 1} title={t.helpful} onClick={() => void rate(m, 1)}>
                      👍
                    </button>
                    <button type="button" className="icon-btn" aria-pressed={m.rating === -1} title={t.notHelpful} onClick={() => void rate(m, -1)}>
                      👎
                    </button>
                  </div>
                ) : null}
              </article>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.placeholder}
            rows={2}
            maxLength={2000}
            disabled={!ready}
            aria-label={t.placeholder}
          />
          {busy ? (
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
              {t.stop}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!ready || input.trim().length < 2}>
              {t.send}
            </button>
          )}
        </form>
      </section>

      <SourcesPanel items={selectedMessage?.citations ?? []} active={activeCite} />
    </div>
  );
}
