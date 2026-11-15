import { describe, expect, it } from 'vitest';
import { checkCitations, ThinkStreamFilter } from '../../src/rag/citations';
import { reciprocalRankFusion } from '../../src/rag/fusion';
import { buildFooter, detectLang } from '../../src/rag/i18n';
import { toOrQuery } from '../../src/rag/keyword-search.service';
import { parseRewrite } from '../../src/rag/query-rewriter.service';

describe('reciprocalRankFusion', () => {
  it('rewards items found by both retrievers', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['c', 'd', 'a'],
    ]);
    expect(fused[0].id).toBe('a'); // 1/61 + 1/63
    expect(fused[1].id).toBe('c'); // 1/63 + 1/61, tie broken by id
    expect(fused.find((f) => f.id === 'd')?.ranks).toEqual([null, 2]);
  });

  it('ignores duplicates within one list', () => {
    const [item] = reciprocalRankFusion([['x', 'x']]);
    expect(item.score).toBeCloseTo(1 / 61);
  });
});

describe('checkCitations', () => {
  it('keeps valid citations and removes invented ones', () => {
    const r = checkCitations('Пособие составляет 60 % [1]. Срок — 12 месяцев [2, 9]. Детали [7].', 3);
    expect(r.used).toEqual([1, 2]);
    expect(r.invalid).toEqual([7, 9]);
    expect(r.text).toBe('Пособие составляет 60 % [1]. Срок — 12 месяцев [2]. Детали.');
  });

  it('detects NO_ANSWER', () => {
    expect(checkCitations('NO_ANSWER', 4).noAnswer).toBe(true);
    expect(checkCitations('<think>hmm</think>\nNO_ANSWER.', 4).noAnswer).toBe(true);
  });

  it('reports no valid citations', () => {
    const r = checkCitations('Ответ без источников.', 4);
    expect(r.used).toEqual([]);
    expect(r.noAnswer).toBe(false);
  });

  it('strips reasoning blocks', () => {
    expect(checkCitations('<think>[5] draft</think>Ответ [1].', 2).text).toBe('Ответ [1].');
  });
});

describe('ThinkStreamFilter', () => {
  it('removes think blocks split across chunks', () => {
    const f = new ThinkStreamFilter();
    const out = ['Hel', 'lo <thi', 'nk>secret', ' stuff</th', 'ink> world'].map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('Hello  world');
  });

  it('passes text with angle brackets through', () => {
    const f = new ThinkStreamFilter();
    expect(f.push('a < b') + f.flush()).toBe('a < b');
  });
});

describe('detectLang', () => {
  it('distinguishes Ukrainian and Russian', () => {
    expect(detectLang('Чи можу я отримати допомогу?')).toBe('uk');
    expect(detectLang('Могу ли я получить пособие, если сам уволился?')).toBe('ru');
    expect(detectLang('Sperrzeit?', 'uk')).toBe('uk');
  });
});

describe('buildFooter', () => {
  it('groups pages per document and shows the version', () => {
    const footer = buildFooter('ru', [
      { title: 'Merkblatt 1', page: 23, docDate: '2025-12-01', dateNote: 'Stand: Dezember 2025' },
      { title: 'Merkblatt 1', page: 12, docDate: '2025-12-01', dateNote: 'Stand: Dezember 2025' },
      { title: 'FW § 159', page: 4, docDate: '2026-07-01', dateNote: null },
    ]);
    expect(footer).toContain('не юридическая консультация');
    expect(footer).toContain('Merkblatt 1, с. 12, 23 (редакция: Stand: Dezember 2025)');
    expect(footer).toContain('FW § 159, с. 4 (редакция: 01.07.2026)');
  });
});

describe('toOrQuery', () => {
  it('joins distinct terms with OR and drops short tokens', () => {
    expect(toOrQuery('Sperrzeit bei Arbeitsaufgabe: wie lange? Sperrzeit')).toBe('sperrzeit or bei or arbeitsaufgabe or wie or lange');
    expect(toOrQuery('a b')).toBe('');
  });
});

describe('parseRewrite', () => {
  it('parses JSON wrapped in code fences and reasoning', () => {
    const r = parseRewrite('<think>…</think>```json\n{"lang":"uk","in_scope":true,"query_de":"Sperrzeit Eigenkündigung Dauer"}\n```');
    expect(r).toEqual({ lang: 'uk', in_scope: true, query_de: 'Sperrzeit Eigenkündigung Dauer' });
  });

  it('accepts an empty query for out-of-scope questions', () => {
    expect(parseRewrite('{"lang": "uk", "in_scope": false, "query_de": ""}')).toEqual({ lang: 'uk', in_scope: false, query_de: '' });
  });

  it('returns null for garbage', () => {
    expect(parseRewrite('Sorry, I cannot help')).toBeNull();
    expect(parseRewrite('{"in_scope": "yes"}')).toBeNull();
    expect(parseRewrite('{"in_scope": true, "query_de": ""}')).toBeNull();
  });
});
