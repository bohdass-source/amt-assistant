import { Injectable } from '@nestjs/common';
import { OllamaEmbeddings } from '@langchain/ollama';
import { env } from '../config/env';

@Injectable()
export class EmbeddingsService {
  private readonly embeddings = new OllamaEmbeddings({
    model: env().EMBEDDING_MODEL,
    baseUrl: env().OLLAMA_URL,
    keepAlive: '30m',
  });

  get model(): string {
    return env().EMBEDDING_MODEL;
  }

  async embedDocuments(texts: string[], batchSize = 16): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      out.push(...(await this.embeddings.embedDocuments(texts.slice(i, i + batchSize))));
    }
    return out;
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}
