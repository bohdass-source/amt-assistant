import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { env } from './config/env';
import { DbService } from './db/db.service';
import { VectorStoreService } from './rag/vector-store.service';

@Controller()
@SkipThrottle()
export class PublicController {
  constructor(
    private readonly db: DbService,
    private readonly vectors: VectorStoreService,
  ) {}

  @Get('health')
  async health() {
    const [db, chroma] = await Promise.all([
      this.db.query('SELECT 1').then(() => true, () => false),
      this.vectors.heartbeat(),
    ]);
    if (!db || !chroma) throw new ServiceUnavailableException({ db, chroma });
    const [index] = await this.db.query<{ documents: number; chunks: number }>(
      `SELECT (SELECT count(*) FROM documents WHERE status = 'ready')::int AS documents,
              (SELECT count(*) FROM chunks)::int AS chunks`,
    );
    const e = env();
    // Model names and the index size let a live check record what it actually ran against.
    return {
      status: 'ok',
      db,
      chroma,
      index,
      models: { embedding: e.EMBEDDING_MODEL, answer: e.LLM_MODEL, rewrite: e.LLM_REWRITE_MODEL ?? e.LLM_MODEL },
      minVectorSimilarity: e.MIN_VECTOR_SIMILARITY,
    };
  }

  /** Public list of the corpus for the Sources page. */
  @Get('documents')
  documents() {
    return this.db.query(
      `SELECT id, title, url, publisher, doc_type AS type, doc_date::text AS date, date_note AS "dateNote",
              status, pages, ingested_at AS "ingestedAt"
         FROM documents ORDER BY doc_type, id`,
    );
  }
}
