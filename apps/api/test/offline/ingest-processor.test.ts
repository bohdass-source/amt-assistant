import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbService } from '../../src/db/db.service';
import type { DocumentRow, DocumentsService } from '../../src/documents/documents.service';
import type { IngestJob } from '../../src/ingest/ingest.constants';
import { IngestProcessor } from '../../src/ingest/ingest.processor';
import type { EmbeddingsService } from '../../src/rag/embeddings.service';
import type { VectorStoreService } from '../../src/rag/vector-store.service';
import type { SourcesService } from '../../src/sources/sources.service';

const PDF = Buffer.from('%PDF-1.7 fake bytes');
const SHA = createHash('sha256').update(PDF).digest('hex');
const PAGE_TEXT = '§ 1 Anwendungsbereich\n' + 'Diese Verordnung regelt die Zulassung von Trägern und Maßnahmen. '.repeat(20);

vi.mock('../../src/ingest/pdf', () => ({
  downloadPdf: vi.fn(async () => PDF),
  extractPages: vi.fn(async () => [{ page: 1, text: PAGE_TEXT }]),
}));

function setup(previous: Partial<DocumentRow> | undefined) {
  const statuses: string[] = [];
  const embedded: string[][] = [];
  const documents = {
    upsertFromSource: async () => {},
    get: async () => previous as DocumentRow | undefined,
    setStatus: async (_id: string, status: string) => void statuses.push(status),
  } as unknown as DocumentsService;
  const sources = {
    get: () => ({ id: 'azav', title: 'AZAV', url: 'https://example.org/azav.pdf', publisher: 'BMAS', type: 'law', date: '2012-04-01' }),
  } as unknown as SourcesService;
  const embeddings = {
    embedDocuments: async (texts: string[]) => {
      embedded.push(texts);
      return texts.map(() => [0.1]);
    },
  } as unknown as EmbeddingsService;
  const vectors = { replaceDocument: async () => {} } as unknown as VectorStoreService;
  const db = { tx: async (fn: (c: { query: () => Promise<void> }) => Promise<void>) => fn({ query: async () => {} }) } as unknown as DbService;
  const processor = new IngestProcessor(db, sources, documents, embeddings, vectors);
  const run = (force = false) =>
    processor.process({ data: { documentId: 'azav', force }, updateProgress: async () => {} } as unknown as Job<IngestJob>);
  return { run, statuses, embedded };
}

describe('IngestProcessor re-ingest guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips an unchanged file even though the API already marked it queued', async () => {
    // This is the state a real re-ingest sees: status `queued`, hash and chunks from the last run.
    const { run, embedded, statuses } = setup({ status: 'queued', sha256: SHA, chunks: 22 });

    await expect(run()).resolves.toMatchObject({ skipped: true, reason: 'unchanged' });
    expect(embedded).toEqual([]);
    expect(statuses.at(-1)).toBe('ready');
  });

  it('re-indexes when forced', async () => {
    const { run, embedded } = setup({ status: 'queued', sha256: SHA, chunks: 22 });

    await expect(run(true)).resolves.toMatchObject({ skipped: false });
    expect(embedded).toHaveLength(1);
  });

  it('indexes a changed file', async () => {
    const { run, embedded } = setup({ status: 'ready', sha256: 'old-hash', chunks: 22 });

    await expect(run()).resolves.toMatchObject({ skipped: false });
    expect(embedded).toHaveLength(1);
  });

  it('indexes when the last run never produced chunks', async () => {
    const { run } = setup({ status: 'failed', sha256: SHA, chunks: 0 });
    await expect(run()).resolves.toMatchObject({ skipped: false });
  });
});
