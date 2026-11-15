import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DocumentsService } from '../documents/documents.service';
import { SourcesService } from '../sources/sources.service';
import { INGEST_QUEUE, ingestJobId, type IngestJob } from './ingest.constants';

@Injectable()
export class IngestService {
  constructor(
    @InjectQueue(INGEST_QUEUE) private readonly queue: Queue<IngestJob>,
    private readonly sources: SourcesService,
    private readonly documents: DocumentsService,
  ) {}

  async enqueue(documentId: string, force = false): Promise<{ documentId: string; queued: boolean }> {
    const source = this.sources.get(documentId);
    await this.documents.upsertFromSource(source);

    const existing = await this.queue.getJob(ingestJobId(documentId));
    if (existing && !(await existing.isCompleted()) && !(await existing.isFailed())) {
      return { documentId, queued: false }; // already waiting or being processed
    }
    if (existing) await existing.remove();

    // Set before adding: a fast job could otherwise finish first and `queued` would overwrite `ready`.
    await this.documents.setStatus(documentId, 'queued');
    await this.queue.add(
      'ingest',
      { documentId, force },
      {
        jobId: ingestJobId(documentId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return { documentId, queued: true };
  }

  async enqueueAll(force = false) {
    const results = [];
    for (const s of this.sources.all()) results.push(await this.enqueue(s.id, force));
    const listed = new Set(this.sources.all().map((s) => s.id));
    const orphaned = (await this.documents.list()).filter((d) => !listed.has(d.id)).map((d) => d.id);
    return { results, orphaned };
  }

  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  }
}
