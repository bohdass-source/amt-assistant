export const INGEST_QUEUE = 'ingest';

export interface IngestJob {
  documentId: string;
  /** true — пересчитать даже если хеш PDF не изменился. */
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

/** Один jobId на документ: пока задача в очереди или в работе, повторный add игнорируется. */
export const ingestJobId = (documentId: string) => `ingest-${documentId}`;
