import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DbService } from '../db/db.service';
import { DocumentsService } from '../documents/documents.service';
import { EmbeddingsService } from '../rag/embeddings.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { SourcesService } from '../sources/sources.service';
import { chunkPages, embeddingText } from './chunker';
import { INGEST_QUEUE, type IngestJob, type IngestOutcome } from './ingest.constants';
import { downloadPdf, extractPages } from './pdf';

@Processor(INGEST_QUEUE, { concurrency: 1 })
export class IngestProcessor extends WorkerHost {
  private readonly log = new Logger(IngestProcessor.name);

  constructor(
    private readonly db: DbService,
    private readonly sources: SourcesService,
    private readonly documents: DocumentsService,
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: VectorStoreService,
  ) {
    super();
  }

  async process(job: Job<IngestJob>): Promise<IngestOutcome> {
    const { documentId, force = false } = job.data;
    const source = this.sources.get(documentId);
    await this.documents.upsertFromSource(source);
    const previous = await this.documents.get(documentId);
    await this.documents.setStatus(documentId, 'processing');

    const pdf = await downloadPdf(source.url);
    const sha256 = createHash('sha256').update(pdf).digest('hex');

    // Защита от повторной загрузки: тот же файл уже проиндексирован — ничего не делаем.
    if (!force && previous?.status === 'ready' && previous.sha256 === sha256) {
      await this.documents.setStatus(documentId, 'ready');
      this.log.log(`${documentId}: unchanged (${sha256.slice(0, 12)}), skipped`);
      return { documentId, skipped: true, reason: 'unchanged', sha256 };
    }
    await job.updateProgress(10);

    const pages = await extractPages(pdf);
    const chars = pages.reduce((n, p) => n + p.text.trim().length, 0);
    if (chars < 200) throw new Error(`No text layer in ${documentId} (scanned PDF?) — OCR is not supported`);

    const chunks = await chunkPages(documentId, pages);
    if (!chunks.length) throw new Error(`No chunks produced for ${documentId}`);
    await job.updateProgress(30);

    const embeddings = await this.embeddings.embedDocuments(chunks.map((c) => embeddingText(source.title, c)));
    await job.updateProgress(80);

    await this.vectors.replaceDocument(
      documentId,
      chunks.map((c, i) => ({ id: c.id, embedding: embeddings[i], text: c.text, documentId, page: c.page, section: c.section })),
    );

    await this.db.tx(async (client) => {
      await client.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
      await client.query(
        `INSERT INTO chunks (id, document_id, page, section, chunk_index, text)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::int[], $6::text[])`,
        [
          chunks.map((c) => c.id),
          chunks.map((c) => c.documentId),
          chunks.map((c) => c.page),
          chunks.map((c) => c.section),
          chunks.map((c) => c.chunkIndex),
          chunks.map((c) => c.text),
        ],
      );
      await client.query(
        `UPDATE documents SET status = 'ready', error = NULL, sha256 = $2, pages = $3, chunks = $4,
                ingested_at = now(), updated_at = now()
          WHERE id = $1`,
        [documentId, sha256, pages.length, chunks.length],
      );
    });

    this.log.log(`${documentId}: ${pages.length} pages → ${chunks.length} chunks`);
    return { documentId, skipped: false, pages: pages.length, chunks: chunks.length, sha256 };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<IngestJob> | undefined, err: Error) {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.log.error(`${job.data.documentId}: attempt ${job.attemptsMade} failed: ${err.message}`);
    await this.documents.setStatus(job.data.documentId, final ? 'failed' : 'queued', err.message.slice(0, 1000));
  }
}
