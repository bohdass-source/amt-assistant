import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { env } from '../config/env';
import { RetrievalService } from '../rag/retrieval.service';

const searchSchema = z.object({
  query: z.string().trim().min(2).max(2000),
  k: z.number().int().min(1).max(50).default(10),
  translate: z.boolean().default(true),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Поиск без генерации — для стенда rag-probe. Возвращает то же, что получает
 * генератор: перевод запроса, решение об отказе и слитый список фрагментов.
 * Контракт описан в docs/search-api.md.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly retrieval: RetrievalService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async search(@Body(new ZodPipe(searchSchema)) body: z.infer<typeof searchSchema>, @Headers('x-api-key') apiKey?: string) {
    const required = env().SEARCH_API_KEY;
    if (required && !(apiKey && safeEqual(apiKey, required))) throw new UnauthorizedException('Invalid x-api-key');

    const r = await this.retrieval.retrieve(body.query, { k: Math.max(body.k, 20), limit: body.k, translate: body.translate, history: body.history });
    return {
      query: r.question,
      lang: r.lang,
      query_de: r.queryDe,
      rewritten: r.rewritten,
      in_scope: r.inScope,
      top_similarity: r.topSimilarity,
      refused: r.refused,
      refusal_reason: r.refusalReason,
      results: r.hits.map((h) => ({
        rank: h.rank,
        chunk_id: h.chunkId,
        document_id: h.documentId,
        title: h.title,
        url: h.url,
        page: h.page,
        section: h.section,
        doc_date: h.docDate,
        text: h.text,
        score: h.score,
        vector_rank: h.vectorRank,
        vector_similarity: h.vectorSimilarity,
        keyword_rank: h.keywordRank,
      })),
      timings_ms: r.timingsMs,
    };
  }
}
