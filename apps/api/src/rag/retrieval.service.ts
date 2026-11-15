import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { DbService } from '../db/db.service';
import { EmbeddingsService } from './embeddings.service';
import { reciprocalRankFusion } from './fusion';
import { detectLang, type Lang, type RefusalReason } from './i18n';
import { KeywordSearchService } from './keyword-search.service';
import type { HistoryTurn } from './prompts';
import { QueryRewriterService } from './query-rewriter.service';
import { VectorStoreService } from './vector-store.service';

export interface Hit {
  rank: number;
  chunkId: string;
  documentId: string;
  title: string;
  /** Direct link to the page: browser PDF viewers understand #page=N. */
  url: string;
  page: number;
  section: string | null;
  text: string;
  docDate: string;
  dateNote: string | null;
  publisher: string;
  score: number;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  keywordRank: number | null;
}

export interface RetrievalResult {
  question: string;
  lang: Lang;
  queryDe: string;
  rewritten: boolean;
  inScope: boolean;
  topSimilarity: number;
  refused: boolean;
  refusalReason: RefusalReason | null;
  hits: Hit[];
  timingsMs: { rewrite: number; search: number; total: number };
}

export interface RetrieveOptions {
  history?: HistoryTurn[];
  k?: number;
  limit?: number;
  /** false: no LLM rewrite, the query is searched as is (deterministic for the test bench). */
  translate?: boolean;
  signal?: AbortSignal;
}

interface ChunkRow {
  id: string;
  document_id: string;
  page: number;
  section: string | null;
  text: string;
  title: string;
  url: string;
  doc_date: string;
  date_note: string | null;
  publisher: string;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly db: DbService,
    private readonly rewriter: QueryRewriterService,
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: VectorStoreService,
    private readonly keywords: KeywordSearchService,
  ) {}

  async retrieve(question: string, opts: RetrieveOptions = {}): Promise<RetrievalResult> {
    const e = env();
    const k = opts.k ?? e.RETRIEVAL_K;
    const limit = opts.limit ?? e.CONTEXT_CHUNKS;
    const t0 = Date.now();

    const rw =
      opts.translate === false
        ? { lang: detectLang(question), inScope: true, queryDe: question, rewritten: false }
        : await this.rewriter.rewrite(question, opts.history ?? [], opts.signal);
    const t1 = Date.now();

    const [vectorHits, keywordHits] = await Promise.all([
      this.embeddings.embedQuery(rw.queryDe).then((v) => this.vectors.search(v, k)),
      this.keywords.search(rw.queryDe, k),
    ]);
    const fused = reciprocalRankFusion([vectorHits.map((h) => h.id), keywordHits.map((h) => h.id)]).slice(0, limit);
    const t2 = Date.now();

    const rows = await this.db.query<ChunkRow>(
      `SELECT c.id, c.document_id, c.page, c.section, c.text,
              d.title, d.url, d.doc_date::text AS doc_date, d.date_note, d.publisher
         FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.id = ANY($1)`,
      [fused.map((f) => f.id)],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const similarity = new Map(vectorHits.map((h) => [h.id, h.similarity]));

    const hits: Hit[] = [];
    for (const f of fused) {
      const r = byId.get(f.id);
      if (!r) continue; // vector exists but the row is gone (document is being re-indexed)
      hits.push({
        rank: hits.length + 1,
        chunkId: r.id,
        documentId: r.document_id,
        title: r.title,
        url: `${r.url}#page=${r.page}`,
        page: r.page,
        section: r.section,
        text: r.text,
        docDate: r.doc_date,
        dateNote: r.date_note,
        publisher: r.publisher,
        score: Number(f.score.toFixed(6)),
        vectorRank: f.ranks[0],
        vectorSimilarity: similarity.has(f.id) ? Number(similarity.get(f.id)!.toFixed(4)) : null,
        keywordRank: f.ranks[1],
      });
    }

    const topSimilarity = vectorHits[0]?.similarity ?? 0;
    let refusalReason: RefusalReason | null = null;
    if (!rw.inScope) refusalReason = 'out_of_scope';
    else if (vectorHits.length === 0 && keywordHits.length === 0) refusalReason = 'empty_index';
    else if (topSimilarity < e.MIN_VECTOR_SIMILARITY) refusalReason = 'low_similarity';

    return {
      question,
      lang: rw.lang,
      queryDe: rw.queryDe,
      rewritten: rw.rewritten,
      inScope: rw.inScope,
      topSimilarity: Number(topSimilarity.toFixed(4)),
      refused: refusalReason !== null,
      refusalReason,
      hits,
      timingsMs: { rewrite: t1 - t0, search: t2 - t1, total: Date.now() - t0 },
    };
  }
}
