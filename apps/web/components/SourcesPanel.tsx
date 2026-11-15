'use client';

import { useEffect, useRef } from 'react';
import type { Citation } from '@/lib/api';
import { formatDate, useLang } from '@/lib/i18n';

export function SourcesPanel({ items, active }: { items: Citation[]; active: number | null }) {
  const { t } = useLang();
  const refs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (active !== null) refs.current.get(active)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [active]);

  return (
    <aside className="sources-panel" aria-label={t.sources}>
      <h2>{t.sources}</h2>
      {items.length === 0 ? (
        <p className="muted">{t.sourcesEmpty}</p>
      ) : (
        <ol className="source-list">
          {items.map((c) => (
            <li
              key={c.chunkId}
              ref={(el) => {
                if (el) refs.current.set(c.n, el);
                else refs.current.delete(c.n);
              }}
              className={active === c.n ? 'source active' : 'source'}
            >
              <div className="source-head">
                <span className="source-n">{c.n}</span>
                <a href={c.url} target="_blank" rel="noopener noreferrer" title={t.openPdf}>
                  {c.title}
                </a>
              </div>
              <div className="source-meta">
                {t.page} {c.page} · {t.version}: {c.dateNote ?? formatDate(c.docDate)}
                {c.section ? <> · {c.section}</> : null}
              </div>
              <blockquote lang="de">{c.snippet}</blockquote>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
