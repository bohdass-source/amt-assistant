// Hand-written fakes for the offline tests. They replace the model, the stores and the
// database, so the pipeline code under test runs exactly as in production.
import type { ConversationsService, Citation } from '../../src/chat/conversations.service';
import type { DbService } from '../../src/db/db.service';
import type { EmbeddingsService } from '../../src/rag/embeddings.service';
import type { KeywordHit, KeywordSearchService } from '../../src/rag/keyword-search.service';
import type { ChatTurn, LlmService } from '../../src/rag/llm.service';
import type { QueryRewriterService, RewriteResult } from '../../src/rag/query-rewriter.service';
import type { Hit, RetrievalResult, RetrievalService } from '../../src/rag/retrieval.service';
import type { VectorHit, VectorStoreService } from '../../src/rag/vector-store.service';

/** LLM that replays a scripted reply, streamed in fixed-size pieces, and records every call. */
export class FakeLlm {
  readonly calls: { kind: 'complete' | 'stream'; turns: ChatTurn[] }[] = [];
  constructor(
    private readonly reply: string | (() => string),
    private readonly pieceSize = 4,
  ) {}

  private text() {
    return typeof this.reply === 'function' ? this.reply() : this.reply;
  }

  async complete(turns: ChatTurn[]): Promise<string> {
    this.calls.push({ kind: 'complete', turns });
    return this.text();
  }

  async *stream(turns: ChatTurn[]): AsyncGenerator<string> {
    this.calls.push({ kind: 'stream', turns });
    const text = this.text();
    for (let i = 0; i < text.length; i += this.pieceSize) yield text.slice(i, i + this.pieceSize);
  }

  asService() {
    return this as unknown as LlmService;
  }
}

/** In-memory conversations: keeps what AnswerService stores. */
export class FakeConversations {
  readonly saved: Record<string, unknown>[] = [];
  async getOrCreate() {
    return 'conv-1';
  }
  async history() {
    return [];
  }
  async addUserMessage() {
    return 'msg-user-1';
  }
  async addAssistantMessage(m: Record<string, unknown>) {
    this.saved.push(m);
    return `msg-assistant-${this.saved.length}`;
  }
  asService() {
    return this as unknown as ConversationsService;
  }
}

export function hit(n: number, over: Partial<Hit> = {}): Hit {
  return {
    rank: n,
    chunkId: `doc-${n}#p${n}-0`,
    documentId: `doc-${n}`,
    title: `Merkblatt ${n}`,
    url: `https://example.org/doc-${n}.pdf#page=${n}`,
    page: n,
    section: null,
    text: `Fragment ${n} text.`,
    docDate: '2026-01-01',
    dateNote: null,
    publisher: 'Bundesagentur für Arbeit',
    score: 1 / (60 + n),
    vectorRank: n,
    vectorSimilarity: 0.7,
    keywordRank: null,
    ...over,
  };
}

export function retrievalResult(over: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    question: 'Получу ли я пособие, если сам уволился?',
    lang: 'ru',
    queryDe: 'Sperrzeit Eigenkündigung',
    rewritten: true,
    inScope: true,
    topSimilarity: 0.7,
    refused: false,
    refusalReason: null,
    hits: [hit(1), hit(2), hit(3)],
    timingsMs: { rewrite: 0, search: 0, total: 0 },
    ...over,
  };
}

export function fakeRetrieval(result: RetrievalResult) {
  return { retrieve: async () => result } as unknown as RetrievalService;
}

/** Stores for RetrievalService: vector hits, keyword hits and the chunk rows behind them. */
export function fakeStores(opts: {
  vector: VectorHit[];
  keyword: KeywordHit[];
  rewrite?: RewriteResult;
  missingRows?: string[];
}) {
  const rewriterCalls: string[] = [];
  const rewriter = {
    rewrite: async (q: string) => {
      rewriterCalls.push(q);
      return opts.rewrite ?? { lang: 'ru', inScope: true, queryDe: 'Sperrzeit', rewritten: true };
    },
  } as unknown as QueryRewriterService;
  const embeddings = { embedQuery: async () => [0.1, 0.2] } as unknown as EmbeddingsService;
  const vectors = { search: async () => opts.vector } as unknown as VectorStoreService;
  const keywords = { search: async () => opts.keyword } as unknown as KeywordSearchService;
  const db = {
    query: async (_sql: string, params: [string[]]) =>
      params[0]
        .filter((id) => !opts.missingRows?.includes(id))
        .map((id) => ({
          id,
          document_id: id.split('#')[0],
          page: Number(/#p(\d+)/.exec(id)?.[1] ?? 1),
          section: null,
          text: `text of ${id}`,
          title: `Title ${id.split('#')[0]}`,
          url: `https://example.org/${id.split('#')[0]}.pdf`,
          doc_date: '2026-01-01',
          date_note: null,
          publisher: 'Bundesagentur für Arbeit',
        })),
  } as unknown as DbService;
  return { rewriter, embeddings, vectors, keywords, db, rewriterCalls };
}

export type { Citation };
