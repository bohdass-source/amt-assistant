import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { Source } from '../sources/sources';

export type DocumentStatus = 'pending' | 'queued' | 'processing' | 'ready' | 'failed';

export interface DocumentRow {
  id: string;
  title: string;
  url: string;
  publisher: string;
  doc_type: string;
  doc_date: string;
  date_note: string | null;
  status: DocumentStatus;
  sha256: string | null;
  pages: number | null;
  chunks: number | null;
  error: string | null;
  ingested_at: string | null;
  updated_at: string;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly db: DbService) {}

  /** Метаданные всегда берутся из sources.yaml; статус и хеш — из последнего ingest. */
  async upsertFromSource(s: Source): Promise<void> {
    await this.db.query(
      `INSERT INTO documents (id, title, url, publisher, doc_type, doc_date, date_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, url = EXCLUDED.url, publisher = EXCLUDED.publisher,
         doc_type = EXCLUDED.doc_type, doc_date = EXCLUDED.doc_date, date_note = EXCLUDED.date_note,
         updated_at = now()`,
      [s.id, s.title, s.url, s.publisher, s.type, s.date, s.date_note ?? null],
    );
  }

  async get(id: string): Promise<DocumentRow | undefined> {
    return this.db.one<DocumentRow>(`SELECT *, doc_date::text AS doc_date FROM documents WHERE id = $1`, [id]);
  }

  async list(): Promise<DocumentRow[]> {
    return this.db.query<DocumentRow>(`SELECT *, doc_date::text AS doc_date FROM documents ORDER BY doc_type, id`);
  }

  async setStatus(id: string, status: DocumentStatus, error: string | null = null): Promise<void> {
    await this.db.query(`UPDATE documents SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [id, status, error]);
  }
}
