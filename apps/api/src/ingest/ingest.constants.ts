export const INGEST_QUEUE = 'ingest';

export interface IngestJob {
  documentId: string;
  /** true: re-index even if the PDF hash has not changed. */
  force?: boolean;
}

export interface IngestOutcome {
  documentId: string;
  skipped: boolean;
  reason?: string;
  pages?: number;
  chunks?: number;
  sha256: string;
}

/** One jobId per document: while a job is waiting or active, another add is ignored. */
export const ingestJobId = (documentId: string) => `ingest-${documentId}`;
