import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { DocumentsService } from './documents/documents.service';
import { IngestProcessor } from './ingest/ingest.processor';
import { QueueModule } from './ingest/queue.module';
import { RagModule } from './rag/rag.module';
import { SourcesService } from './sources/sources.service';

/** Отдельный процесс: тяжёлый ingest (PDF, эмбеддинги) не тормозит ответы API. */
@Module({
  imports: [DbModule, QueueModule, RagModule],
  providers: [SourcesService, DocumentsService, IngestProcessor],
})
export class WorkerModule {}
