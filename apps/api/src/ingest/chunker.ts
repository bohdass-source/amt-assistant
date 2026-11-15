import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface PageText {
  /** Page number in the PDF file, starting at 1. Used for the url#page=N link. */
  page: number;
  text: string;
}

export interface ChunkDraft {
  /** Readable, stable id `<documentId>#p<page>-<n>`, convenient for rag-probe qrels. */
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
  /** A segment shorter than this is merged with the next one on the same page. */
  minSegment: number;
  /** Segments still shorter than this after merging are dropped as noise. */
  minChunk: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 1200,
  chunkOverlap: 150,
  minSegment: 250,
  minChunk: 40,
};

const HEADING_PATTERNS: RegExp[] = [
  // § 138 SGB III / § 159 Ruhen bei Sperrzeit, but not "§ 37 Abs. 2 SGB X; wird …" from running text
  /^§\s?\d+[a-z]?\s+SGB\s+[IVX]+$/u,
  /^§\s?\d+[a-z]?\s+(SGB\s+[IVX]+\s+)?\p{Lu}[\p{L}\- ]{2,60}$/u,
  // 2. Antrag stellen / 2.3 Anspruchsdauer / 4.1.2 Fahrkosten: the dot is required,
  // otherwise "5 Jahre verlängert …" in the middle of a paragraph looks like a heading
  /^\d{1,2}\.(\d{1,2}\.?){0,4}\s+\p{Lu}[\p{L}\p{N}\-–,/()§? ]{2,}$/u,
  // Kapitel 3 / Anlage 1 - Rechtsfolgenbelehrung / Teil B
  /^(Teil|Kapitel|Abschnitt|Anlage|Anhang)\s+[\dIVXA-Z]+\b/u,
  // A. Konstruktionsprinzipien
  /^[A-H]\.\s+\p{Lu}/u,
];

const PAGE_NUMBER_LINE = /^(seite\s*)?\d{1,3}(\s*(von|\/)\s*\d{1,3})?$/i;
// "Anlage 1 Seite 24 (07/2026) § 159", "BA Zentrale, GR3 Seite 1 von 4": running headers and footers
const PAGE_FURNITURE = /^.{0,50}\bSeite\s+\d+(\s+von\s+\d+)?\b.{0,40}$/i;
// table-of-contents lines: dot leaders or a trailing page number
const TOC_LINE = /(\.{4,}|…{2,})\s*\d*$|\s\d{1,3}$/;

export function normalizeText(raw: string): string {
  return (
    raw
      .replace(/\r/g, '')
      // soft hyphen (U+00AD) together with the line break after it
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
  // sentences end with punctuation; those are not headings
  if (/[.:;,]$/.test(line)) return false;
  if (TOC_LINE.test(line)) return false;
  return HEADING_PATTERNS.some((p) => p.test(line));
}

/** Line key without digits: "Seite 3 von 72" and "Seite 4 von 72" give the same key. */
function boilerKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/** Running headers/footers are lines that repeat on most pages. */
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
 * Section-aware chunking: headings (§, numbering, "Anlage…") open a new section.
 * A section continues across a page break, but a chunk never crosses a page,
 * otherwise the page reference would be wrong.
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

    // A short segment (often a lone heading) is merged into the next one.
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

/** Text to embed: the document and section titles give the chunk context. */
export function embeddingText(title: string, chunk: Pick<ChunkDraft, 'section' | 'text'>): string {
  return [title, chunk.section, chunk.text].filter(Boolean).join('\n');
}
