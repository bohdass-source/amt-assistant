'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, ensureSession, login, setToken, type SessionUser } from '@/lib/api';
import { formatDate } from '@/lib/i18n';

interface AdminDocument {
  id: string;
  title: string;
  url: string;
  type: string;
  date: string;
  dateNote: string | null;
  status: 'pending' | 'queued' | 'processing' | 'ready' | 'failed';
  pages: number | null;
  chunks: number | null;
  sha256: string | null;
  error: string | null;
  ingestedAt: string | null;
}

interface AdminData {
  documents: AdminDocument[];
  orphaned: { id: string; title: string }[];
  queue: Record<string, number>;
}

interface Stats {
  totals: Record<string, number>;
  negative: { message_id: string; question: string | null; answer: string; comment: string | null; created_at: string }[];
}

const STATUS_LABEL: Record<AdminDocument['status'], string> = {
  pending: 'не загружен',
  queued: 'в очереди',
  processing: 'обработка',
  ready: 'готов',
  failed: 'ошибка',
};

/** Админ-страница на русском: ей пользуется команда проекта, а не посетители. */
export function Admin() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [d, s] = await Promise.all([api<AdminData>('/admin/documents'), api<Stats>('/admin/stats')]);
    setData(d);
    setStats(s);
  }, []);

  useEffect(() => {
    ensureSession().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    void refresh();
    const timer = setInterval(() => void refresh().catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setUser(await login(email, password));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Неверный email или пароль' : 'Ошибка входа');
    }
  };

  const run = async (path: string, force = false) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ force }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="page narrow">
        <h1>Вход для администратора</h1>
        <form className="login-form" onSubmit={onLogin}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="btn btn-primary">
            Войти
          </button>
        </form>
      </div>
    );
  }

  const ready = data?.documents.filter((d) => d.status === 'ready').length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Документы корпуса</h1>
          <p className="muted">
            Готово {ready} из {data?.documents.length ?? '…'} · очередь: ждут {data?.queue.waiting ?? 0}, в работе {data?.queue.active ?? 0},
            ошибок {data?.queue.failed ?? 0}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run('/admin/documents/sync')}>
            Загрузить все из sources.yaml
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void run('/admin/documents/sync', true)}>
            Переиндексировать всё
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setToken(null);
              setUser(null);
            }}
          >
            Выйти
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Документ</th>
              <th>Редакция</th>
              <th>Статус</th>
              <th>Стр.</th>
              <th>Фрагм.</th>
              <th>SHA-256</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <a href={d.url} target="_blank" rel="noopener noreferrer">
                    {d.title}
                  </a>
                  <div className="muted small mono">{d.id}</div>
                  {d.error ? <div className="error small">{d.error}</div> : null}
                </td>
                <td className="nowrap">{d.dateNote ?? formatDate(d.date)}</td>
                <td>
                  <span className={`badge badge-${d.status}`}>{STATUS_LABEL[d.status]}</span>
                </td>
                <td>{d.pages ?? '—'}</td>
                <td>{d.chunks ?? '—'}</td>
                <td className="mono small">{d.sha256 ? d.sha256.slice(0, 10) : '—'}</td>
                <td>
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(`/admin/documents/${d.id}/ingest`, true)}>
                    Переиндексировать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.orphaned.length ? (
        <p className="muted small">В базе есть документы, которых больше нет в sources.yaml: {data.orphaned.map((o) => o.id).join(', ')}</p>
      ) : null}

      {stats ? (
        <section className="stats">
          <h2>Использование и оценки</h2>
          <dl className="stat-grid">
            {Object.entries({
              'Ответов': stats.totals.answers,
              'Отказов': stats.totals.refusals,
              '👍': stats.totals.thumbs_up,
              '👎': stats.totals.thumbs_down,
              'Диалогов': stats.totals.conversations,
              'Гостей': stats.totals.guests,
            }).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v ?? 0}</dd>
              </div>
            ))}
          </dl>
          {stats.negative.length ? (
            <>
              <h3>Последние отрицательные оценки</h3>
              <ul className="negative-list">
                {stats.negative.map((n) => (
                  <li key={n.message_id}>
                    <strong>{n.question}</strong>
                    <p className="small">{n.answer.slice(0, 400)}</p>
                    {n.comment ? <p className="small muted">Комментарий: {n.comment}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
