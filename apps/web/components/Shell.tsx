'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LangProvider, useLang } from '@/lib/i18n';

function Header() {
  const { lang, t, setLang } = useLang();
  const path = usePathname();
  const nav = [
    { href: '/', label: t.navChat },
    { href: '/sources', label: t.navSources },
    { href: '/admin', label: t.navAdmin },
  ];
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Amt-Assistent">
        <span className="brand-mark" aria-hidden>
          §
        </span>
        <span>
          <strong>Amt-Assistent</strong>
          <small>{t.tagline}</small>
        </span>
      </Link>
      <nav className="site-nav">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={path === n.href ? 'page' : undefined}>
            {n.label}
          </Link>
        ))}
        <div className="lang-switch" role="group" aria-label="Мова / Язык">
          {(['ru', 'uk'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const { t } = useLang();
  return (
    <footer className="site-footer" role="note">
      {t.disclaimer}
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <div className="app">
        <Header />
        <main className="app-main">{children}</main>
        <Footer />
      </div>
    </LangProvider>
  );
}
