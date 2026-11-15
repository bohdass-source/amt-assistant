import { describe, expect, it } from 'vitest';
import { RetrievalService } from '../../src/rag/retrieval.service';
import { fakeStores } from './fakes';

// MIN_VECTOR_SIMILARITY is not set in the offline environment, so the default 0.45 applies.
function service(stores: ReturnType<typeof fakeStores>) {
  return new RetrievalService(stores.db, stores.rewriter, stores.embeddings, stores.vectors, stores.keywords);
}

describe('RetrievalService with fake stores', () => {
  it('ranks an excerpt found by both retrievers first and links to its page', async () => {
    const stores = fakeStores({
      vector: [
        { id: 'a#p3-0', similarity: 0.71 },
        { id: 'b#p1-0', similarity: 0.6 },
      ],
      keyword: [
        { id: 'c#p2-0', rank: 0.9 },
        { id: 'a#p3-0', rank: 0.5 },
      ],
    });
    const r = await service(stores).retrieve('Sperrzeit?');

    expect(r.refused).toBe(false);
    // a: 1/61 + 1/62; c: first keyword hit, 1/61; b: second vector hit, 1/62.
    expect(r.hits.map((h) => h.chunkId)).toEqual(['a#p3-0', 'c#p2-0', 'b#p1-0']);
    expect(r.hits[0]).toMatchObject({ url: 'https://example.org/a.pdf#page=3', vectorRank: 1, keywordRank: 2, vectorSimilarity: 0.71 });
    expect(r.hits[1]).toMatchObject({ vectorRank: null, vectorSimilarity: null, keywordRank: 1 });
  });

  it('refuses out-of-scope questions even when the stores return matches', async () => {
    const stores = fakeStores({
      vector: [{ id: 'a#p1-0', similarity: 0.9 }],
      keyword: [],
      rewrite: { lang: 'uk', inScope: false, queryDe: 'Kindergeld', rewritten: true },
    });
    const r = await service(stores).retrieve('Скільки становить Kindergeld?');

    expect(r).toMatchObject({ refused: true, refusalReason: 'out_of_scope', lang: 'uk' });
  });

  it('refuses when the best vector match is below the threshold', async () => {
    const stores = fakeStores({ vector: [{ id: 'a#p1-0', similarity: 0.44 }], keyword: [{ id: 'a#p1-0', rank: 1 }] });
    const r = await service(stores).retrieve('Какая погода в Берлине?');

    expect(r).toMatchObject({ refused: true, refusalReason: 'low_similarity', topSimilarity: 0.44 });
  });

  it('reports an empty index', async () => {
    const r = await service(fakeStores({ vector: [], keyword: [] })).retrieve('Sperrzeit?');
    expect(r).toMatchObject({ refused: true, refusalReason: 'empty_index', hits: [] });
  });

  it('skips the model rewrite when translate is false', async () => {
    const stores = fakeStores({ vector: [{ id: 'a#p1-0', similarity: 0.8 }], keyword: [] });
    const r = await service(stores).retrieve('Чи можу я отримати допомогу?', { translate: false });

    expect(stores.rewriterCalls).toEqual([]);
    expect(r).toMatchObject({ rewritten: false, queryDe: 'Чи можу я отримати допомогу?', lang: 'uk' });
  });

  it('drops excerpts whose rows disappeared during re-indexing', async () => {
    const stores = fakeStores({
      vector: [
        { id: 'a#p1-0', similarity: 0.8 },
        { id: 'b#p1-0', similarity: 0.7 },
      ],
      keyword: [],
      missingRows: ['a#p1-0'],
    });
    const r = await service(stores).retrieve('Sperrzeit?');

    expect(r.hits.map((h) => [h.chunkId, h.rank])).toEqual([['b#p1-0', 1]]);
  });
});
