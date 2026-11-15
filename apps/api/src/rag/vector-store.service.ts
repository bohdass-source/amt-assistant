import { Injectable, Logger } from '@nestjs/common';
import { ChromaClient, type Collection } from 'chromadb';
import { env } from '../config/env';

export interface VectorRecord {
  id: string;
  embedding: number[];
  text: string;
  documentId: string;
  page: number;
  section: string | null;
}

export interface VectorHit {
  id: string;
  /** 1 − cosine distance; the collection is created with space=cosine. */
  similarity: number;
}

@Injectable()
export class VectorStoreService {
  private readonly log = new Logger(VectorStoreService.name);
  private readonly client: ChromaClient;
  private collection?: Promise<Collection>;

  constructor() {
    const u = new URL(env().CHROMA_URL);
    const ssl = u.protocol === 'https:';
    this.client = new ChromaClient({ host: u.hostname, port: Number(u.port || (ssl ? 443 : 8000)), ssl });
  }

  private col(): Promise<Collection> {
    if (!this.collection) {
      this.collection = this.client
        .getOrCreateCollection({
          name: env().CHROMA_COLLECTION,
          // Embeddings are computed via Ollama, so Chroma's built-in function is not needed.
          embeddingFunction: null,
          configuration: { hnsw: { space: 'cosine' } },
          metadata: { embedding_model: env().EMBEDDING_MODEL },
        })
        .then((c) => {
          const model = c.metadata?.embedding_model;
          if (model && model !== env().EMBEDDING_MODEL) {
            this.log.warn(`Collection was built with ${model}, but EMBEDDING_MODEL=${env().EMBEDDING_MODEL}. Re-ingest with force.`);
          }
          return c;
        })
        .catch((err) => {
          this.collection = undefined;
          throw err;
        });
    }
    return this.collection;
  }

  /** Delete all vectors of the document first, then write the new ones, so re-ingest leaves no duplicates. */
  async replaceDocument(documentId: string, records: VectorRecord[]): Promise<void> {
    const c = await this.col();
    await c.delete({ where: { document_id: documentId } });
    for (let i = 0; i < records.length; i += 100) {
      const batch = records.slice(i, i + 100);
      await c.upsert({
        ids: batch.map((r) => r.id),
        embeddings: batch.map((r) => r.embedding),
        documents: batch.map((r) => r.text),
        metadatas: batch.map((r) => ({ document_id: r.documentId, page: r.page, section: r.section ?? '' })),
      });
    }
  }

  async search(embedding: number[], k: number): Promise<VectorHit[]> {
    const c = await this.col();
    const res = await c.query({ queryEmbeddings: [embedding], nResults: k, include: ['distances'] });
    const ids = res.ids[0] ?? [];
    const distances = res.distances[0] ?? [];
    return ids.map((id, i) => ({ id, similarity: 1 - (distances[i] ?? 1) }));
  }

  async count(): Promise<number> {
    return (await this.col()).count();
  }

  async heartbeat(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }
}
