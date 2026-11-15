'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, useLang } from '@/lib/i18n';

interface PublicDocument {
  id: string;
  title: string;
  url: string;
  publisher: string;
  type: string;
  date: string;
  dateNote: string | null;
  status: string;
  pages: number | null;
}

export function SourcesList() {
  const { t } = useLang();
  const [docs, setDocs] = useState<PublicDocument[] | null>(null);

  useEffect(() => {
    api<PublicDocument[]>('/documents').then(setDocs).catch(() => setDocs([]));
  }, []);

  return (
    <div className="page">
      <h1>{t.corpusTitle}</h1>
      <p className="muted">{t.corpusText}</p>
      <ul className="corpus">
        {docs?.map((d) => (
          <li key={d.id}>
            <a href={d.url} target="_blank" rel="noopener noreferrer" lang="de">
              {d.title}
            </a>
            <div className="muted small">
              {d.publisher} · {t.version}: {d.dateNote ?? formatDate(d.date)}
              {d.pages ? ` · ${t.pages}: ${d.pages}` : ''}
              {d.status !== 'ready' ? ` · ${t.status}: ${d.status}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
