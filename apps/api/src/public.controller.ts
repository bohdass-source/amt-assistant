import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
    return { status: 'ok', db, chroma };
  }

  /** Публичный список корпуса для страницы «Источники». */
  @Get('documents')
  documents() {
    return this.db.query(
      `SELECT id, title, url, publisher, doc_type AS type, doc_date::text AS date, date_note AS "dateNote",
              status, pages, ingested_at AS "ingestedAt"
         FROM documents ORDER BY doc_type, id`,
    );
  }
}
