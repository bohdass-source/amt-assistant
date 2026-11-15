import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { KeywordSearchService } from './keyword-search.service';
import { LlmService } from './llm.service';
import { QueryRewriterService } from './query-rewriter.service';
import { RetrievalService } from './retrieval.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  providers: [EmbeddingsService, VectorStoreService, KeywordSearchService, LlmService, QueryRewriterService, RetrievalService],
  exports: [EmbeddingsService, VectorStoreService, KeywordSearchService, LlmService, QueryRewriterService, RetrievalService],
})
export class RagModule {}
