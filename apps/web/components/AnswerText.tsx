'use client';

import { Fragment, type ReactNode } from 'react';
import { useLang } from '@/lib/i18n';

/** Minimal answer renderer: paragraphs, lists, **bold** and clickable [n] footnotes. */
export function AnswerText({
  text,
  citable,
  onCite,
}: {
  text: string;
  citable: Set<number>;
  onCite: (n: number) => void;
}) {
  const { t } = useLang();
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\[\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) {
        const n = Number(cite[1]);
        return citable.has(n) ? (
          <button key={`${key}-${i}`} type="button" className="cite" onClick={() => onCite(n)} aria-label={`${t.citeLabel} ${n}`}>
            {n}
          </button>
        ) : (
          <Fragment key={`${key}-${i}`} />
        );
      }
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      if (bold) return <strong key={`${key}-${i}`}>{bold[1]}</strong>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });

  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{inline(lines.join(' '), String(bi))}</p>;
      })}
    </>
  );
}
