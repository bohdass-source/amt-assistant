import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, Roles } from '../auth/auth.guards';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { DocumentsService } from '../documents/documents.service';
import { IngestService } from '../ingest/ingest.service';
import { SourcesService } from '../sources/sources.service';

const forceSchema = z.object({ force: z.boolean().default(false) }).default({ force: false });

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly sources: SourcesService,
    private readonly ingest: IngestService,
  ) {}

  /** Documents from sources.yaml with their ingest status; those never ingested are `pending`. */
  @Get('documents')
  async list() {
    const rows = new Map((await this.documents.list()).map((d) => [d.id, d]));
    const listed = this.sources.all().map((s) => {
      const row = rows.get(s.id);
      return {
        id: s.id,
        title: s.title,
        url: s.url,
        publisher: s.publisher,
        type: s.type,
        date: s.date,
        dateNote: s.date_note ?? null,
        status: row?.status ?? 'pending',
        pages: row?.pages ?? null,
        chunks: row?.chunks ?? null,
        sha256: row?.sha256 ?? null,
        error: row?.error ?? null,
        ingestedAt: row?.ingested_at ?? null,
        inSourcesFile: true,
      };
    });
    const orphaned = [...rows.values()]
      .filter((r) => !this.sources.all().some((s) => s.id === r.id))
      .map((r) => ({ ...r, inSourcesFile: false }));
    return { documents: listed, orphaned, queue: await this.ingest.counts() };
  }

  @Post('documents/sync')
  @HttpCode(202)
  sync(@Body(new ZodPipe(forceSchema)) body: { force: boolean }) {
    return this.ingest.enqueueAll(body.force);
  }

  @Post('documents/:id/ingest')
  @HttpCode(202)
  reingest(@Param('id') id: string, @Body(new ZodPipe(forceSchema)) body: { force: boolean }) {
    return this.ingest.enqueue(id, body.force);
  }

  @Get('stats')
  async stats() {
    const [totals] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM users WHERE NOT is_guest)::int AS registered_users,
         (SELECT count(*) FROM users WHERE is_guest)::int AS guests,
         (SELECT count(*) FROM conversations)::int AS conversations,
         (SELECT count(*) FROM messages WHERE role = 'assistant')::int AS answers,
         (SELECT count(*) FROM messages WHERE role = 'assistant' AND refused)::int AS refusals,
         (SELECT count(*) FROM ratings WHERE score = 1)::int AS thumbs_up,
         (SELECT count(*) FROM ratings WHERE score = -1)::int AS thumbs_down`,
    );
    const negative = await this.db.query(
      `SELECT r.created_at, r.comment, a.id AS message_id, a.content AS answer, a.refused,
              (SELECT q.content FROM messages q
                WHERE q.conversation_id = a.conversation_id AND q.role = 'user' AND q.created_at < a.created_at
                ORDER BY q.created_at DESC LIMIT 1) AS question
         FROM ratings r JOIN messages a ON a.id = r.message_id
        WHERE r.score = -1
        ORDER BY r.created_at DESC LIMIT 20`,
    );
    return { totals, negative };
  }
}
