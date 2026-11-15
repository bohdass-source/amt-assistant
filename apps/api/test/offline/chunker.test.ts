import { describe, expect, it } from 'vitest';
import { chunkPages, detectBoilerplate, isHeading, normalizeText } from '../../src/ingest/chunker';

describe('normalizeText', () => {
  it('joins hyphenated words and removes soft hyphens', () => {
    expect(normalizeText('Arbeits-\nlosengeld')).toBe('Arbeitslosengeld');
    expect(normalizeText('Informationsbro­\nschüre')).toBe('Informationsbroschüre');
  });

  it('keeps hyphens before capitalised words and inside a line', () => {
    expect(normalizeText('Arbeitslosen-\nVersicherung')).toBe('Arbeitslosen-\nVersicherung');
    expect(normalizeText('Kranken- und  Pflegeversicherung')).toBe('Kranken- und Pflegeversicherung');
  });
});

describe('isHeading', () => {
  it.each([
    '§ 159 SGB III',
    '§ 138 Arbeitslosigkeit',
    '2.1 Arbeitslos melden',
    '1.1.2 Nachholen eines Berufsabschlusses',
    '6. Bildungsgutschein (BGS)',
    'Anlage 6 - Beispiele zum wichtigen Grund',
    'A. Konstruktionsprinzipien berufsanschlussfähiger Teilqualifikationen',
  ])('detects %s', (line) => expect(isHeading(line)).toBe(true));

  it.each([
    '5 Jahre verlängert und dadurch unter Umständen eine',
    '§ 37 Abs. 2 SGB X; wird der Zugang bestritten und lässt er sich nicht',
    '3.2 Anspruchsdauer 33',
    'Anlage 7 – Weitere Informationen ........................ 40',
    'Sie müssen sich spätestens drei Monate vorher melden.',
  ])('rejects %s', (line) => expect(isHeading(line)).toBe(false));
});

describe('detectBoilerplate', () => {
  it('finds lines repeated on most pages regardless of page numbers', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => ({ page: n, text: `BA Zentrale Stand 03/2026\nInhalt Seite ${n}` }));
    expect(detectBoilerplate(pages).has('ba zentrale stand #/#')).toBe(true);
  });
});

describe('chunkPages', () => {
  const body = (word: string) => Array.from({ length: 40 }, (_, i) => `${word} Satz Nummer ${i} mit Inhalt.`).join('\n');

  it('carries the section across pages and never crosses a page boundary', async () => {
    const chunks = await chunkPages('ba-fw-159', [
      { page: 1, text: `§ 159 Ruhen bei Sperrzeit\n${body('Erste')}` },
      { page: 2, text: body('Zweite') },
      { page: 3, text: `2.1 Sperrzeit bei Arbeitsaufgabe\n${body('Dritte')}` },
    ]);
    expect(chunks.length).toBeGreaterThan(3);
    const p2 = chunks.filter((c) => c.page === 2);
    expect(p2.every((c) => c.section === '§ 159 Ruhen bei Sperrzeit')).toBe(true);
    expect(p2.every((c) => c.text.includes('Zweite') && !c.text.includes('Erste'))).toBe(true);
    expect(chunks.filter((c) => c.page === 3).at(-1)?.section).toBe('2.1 Sperrzeit bei Arbeitsaufgabe');
  });

  it('produces stable, readable, unique ids', async () => {
    const pages = [{ page: 7, text: body('Text') }];
    const a = await chunkPages('ba-merkblatt-1-arbeitslose', pages);
    const b = await chunkPages('ba-merkblatt-1-arbeitslose', pages);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a[0].id).toBe('ba-merkblatt-1-arbeitslose#p7-0');
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });

  it('respects the chunk size', async () => {
    const chunks = await chunkPages('d', [{ page: 1, text: body('Lang') }], { chunkSize: 400, chunkOverlap: 40 });
    expect(chunks.every((c) => c.text.length <= 400)).toBe(true);
  });

  it('merges a lone heading into the following segment', async () => {
    const chunks = await chunkPages('d', [{ page: 1, text: `1. Allgemeines\n1.1 Anspruch\n${body('Inhalt')}` }]);
    expect(chunks[0].text.startsWith('1. Allgemeines')).toBe(true);
    expect(chunks[0].section).toBe('1.1 Anspruch');
  });
});
