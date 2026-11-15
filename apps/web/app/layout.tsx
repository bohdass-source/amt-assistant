import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amt-Assistent — пособие по безработице и оплата обучения',
  description:
    'Ответы на русском и украинском по официальным документам Bundesagentur für Arbeit: Arbeitslosengeld, Sperrzeit, Bildungsgutschein. Со ссылкой на документ и страницу. Не юридическая консультация.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#11151b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
