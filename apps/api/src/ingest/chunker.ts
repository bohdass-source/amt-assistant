import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface PageText {
  /** Номер страницы в PDF-файле, с 1. По нему строится ссылка url#page=N. */
  page: number;
  text: string;
}

export interface ChunkDraft {
  /** Читаемый и стабильный id: `<documentId>#p<page>-<n>` — удобно для qrels в rag-probe. */
  id: string;
  documentId: string;
  page: number;
  section: string | null;
  chunkIndex: number;
  text: string;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  /** Сегмент короче этого склеивается со следующим на той же странице. */
  minSegment: number;
  /** Сегменты короче этого после склейки отбрасываются как шум. */
  minChunk: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 1200,
  chunkOverlap: 150,
  minSegment: 250,
  minChunk: 40,
};

const HEADING_PATTERNS: RegExp[] = [
  // § 138 SGB III / § 159 Ruhen bei Sperrzeit — но не «§ 37 Abs. 2 SGB X; wird …» из текста
  /^§\s?\d+[a-z]?\s+SGB\s+[IVX]+$/u,
  /^§\s?\d+[a-z]?\s+(SGB\s+[IVX]+\s+)?\p{Lu}[\p{L}\- ]{2,60}$/u,
  // 2. Antrag stellen / 2.3 Anspruchsdauer / 4.1.2 Fahrkosten — точка обязательна,
  // иначе «5 Jahre verlängert …» из середины абзаца считается заголовком
  /^\d{1,2}\.(\d{1,2}\.?){0,4}\s+\p{Lu}[\p{L}\p{N}\-–,/()§? ]{2,}$/u,
  // Kapitel 3 / Anlage 1 - Rechtsfolgenbelehrung / Teil B
  /^(Teil|Kapitel|Abschnitt|Anlage|Anhang)\s+[\dIVXA-Z]+\b/u,
  // A. Konstruktionsprinzipien
  /^[A-H]\.\s+\p{Lu}/u,
];

const PAGE_NUMBER_LINE = /^(seite\s*)?\d{1,3}(\s*(von|\/)\s*\d{1,3})?$/i;
// «Anlage 1 Seite 24 (07/2026) § 159», «BA Zentrale, GR3 Seite 1 von 4» — колонтитулы
const PAGE_FURNITURE = /^.{0,50}\bSeite\s+\d+(\s+von\s+\d+)?\b.{0,40}$/i;
// строки оглавления: точки-заполнители или номер страницы в конце
const TOC_LINE = /(\.{4,}|…{2,})\s*\d*$|\s\d{1,3}$/;

export function normalizeText(raw: string): string {
  return (
    raw
      .replace(/\r/g, '')
      // мягкий перенос (U+00AD) вместе с разрывом строки после него
      .replace(/­\n?/g, '')
      .replace(/[ \t ]+/g, ' ')
      // Silbentrennung: "Arbeits-\nlosengeld" → "Arbeitslosengeld"
      .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export function isHeading(line: string): boolean {
  if (line.length < 3 || line.length > 120) return false;
  // предложения заканчиваются знаком препинания — это не заголовки
  if (/[.:;,]$/.test(line)) return false;
  if (TOC_LINE.test(line)) return false;
  return HEADING_PATTERNS.some((p) => p.test(line));
}

/** Ключ строки без цифр: «Seite 3 von 72» и «Seite 4 von 72» дают один ключ. */
function boilerKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/** Колонтитулы — строки, которые повторяются на большинстве страниц. */
export function detectBoilerplate(pages: PageText[], minShare = 0.4): Set<string> {
  if (pages.length < 4) return new Set();
  const counts = new Map<string, number>();
  for (const p of pages) {
    const keys = new Set(normalizeText(p.text).split('\n').filter(Boolean).map(boilerKey));
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * minShare));
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
}

interface Segment {
  section: string | null;
  lines: string[];
}

const textOf = (s: Segment) => s.lines.join('\n');

/**
 * Чанкинг по разделам: заголовки (§, нумерация, «Anlage…») открывают новый раздел,
 * раздел продолжается через границу страницы, но фрагмент никогда не пересекает
 * страницу — иначе ссылка на страницу была бы неточной.
 */
export async function chunkPages(
  documentId: string,
  pages: PageText[],
  options: Partial<ChunkOptions> = {},
): Promise<ChunkDraft[]> {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const boiler = detectBoilerplate(pages);
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: opts.chunkSize,
    chunkOverlap: opts.chunkOverlap,
    separators: ['\n\n', '\n', '. ', '; ', ' ', ''],
  });

  const out: ChunkDraft[] = [];
  let section: string | null = null;

  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    const lines = normalizeText(p.text)
      .split('\n')
      .filter((l) => l && !PAGE_NUMBER_LINE.test(l) && !PAGE_FURNITURE.test(l) && !boiler.has(boilerKey(l)));

    const segments: Segment[] = [];
    let current: Segment = { section, lines: [] };
    for (const line of lines) {
      if (isHeading(line)) {
        if (current.lines.length) segments.push(current);
        section = line;
        current = { section, lines: [line] };
      } else {
        current.lines.push(line);
      }
    }
    if (current.lines.length) segments.push(current);

    // Короткий сегмент (часто один заголовок) приклеиваем к следующему.
    const merged: Segment[] = [];
    for (const s of segments) {
      const prev = merged[merged.length - 1];
      if (prev && textOf(prev).length < opts.minSegment) {
        prev.lines.push(...s.lines);
        prev.section = s.section ?? prev.section;
      } else {
        merged.push({ section: s.section, lines: [...s.lines] });
      }
    }

    let index = 0;
    for (const s of merged) {
      const text = textOf(s);
      if (text.length < opts.minChunk) continue;
      for (const part of await splitter.splitText(text)) {
        const trimmed = part.trim();
        if (trimmed.length < opts.minChunk) continue;
        out.push({
          id: `${documentId}#p${p.page}-${index}`,
          documentId,
          page: p.page,
          section: s.section,
          chunkIndex: index,
          text: trimmed,
        });
        index += 1;
      }
    }
  }
  return out;
}

/** Текст для эмбеддинга: заголовок документа и раздела дают фрагменту контекст. */
export function embeddingText(title: string, chunk: Pick<ChunkDraft, 'section' | 'text'>): string {
  return [title, chunk.section, chunk.text].filter(Boolean).join('\n');
}
