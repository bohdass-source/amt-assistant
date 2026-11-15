import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseSources } from './sources';

const root = resolve(__dirname, '../../../..');

describe('data/sources.yaml', () => {
  const file = parseSources(readFileSync(resolve(root, 'data/sources.yaml'), 'utf8'));

  it('has 15–25 documents on one topic', () => {
    expect(file.documents.length).toBeGreaterThanOrEqual(15);
    expect(file.documents.length).toBeLessThanOrEqual(25);
  });

  it('every document has an https url and a date', () => {
    for (const d of file.documents) {
      expect(d.url).toMatch(/^https:\/\/www\.(arbeitsagentur|gesetze-im-internet)\.de\//);
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parseSources(`topic: t
documents:
  - {id: a-1, title: Doc, publisher: BA, type: merkblatt, url: "https://x.de/a.pdf", date: 2026-01-01, retrieved: 2026-11-15}
  - {id: a-1, title: Doc, publisher: BA, type: merkblatt, url: "https://x.de/b.pdf", date: 2026-01-01, retrieved: 2026-11-15}
`),
    ).toThrow(/duplicate id/);
  });
});

describe('data/eval/questions.yaml', () => {
  const ids = new Set(parseSources(readFileSync(resolve(root, 'data/sources.yaml'), 'utf8')).documents.map((d) => d.id));
  const evalSet = parse(readFileSync(resolve(root, 'data/eval/questions.yaml'), 'utf8')) as {
    answerable: { id: string; expected_documents: string[] }[];
    out_of_corpus: { id: string }[];
  };

  it('has 20 control questions that point at listed documents', () => {
    expect(evalSet.answerable).toHaveLength(20);
    for (const q of evalSet.answerable) {
      for (const d of q.expected_documents) expect(ids.has(d), `${q.id} → ${d}`).toBe(true);
    }
  });

  it('has out-of-corpus questions for the refusal check', () => {
    expect(evalSet.out_of_corpus.length).toBeGreaterThanOrEqual(5);
  });
});
