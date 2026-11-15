import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { AnswerService } from './chat/answer.service';
import { ChatController } from './chat/chat.controller';
import { ConversationsService } from './chat/conversations.service';
import { DbModule } from './db/db.module';
import { DocumentsService } from './documents/documents.service';
import { IngestService } from './ingest/ingest.service';
import { QueueModule } from './ingest/queue.module';
import { PublicController } from './public.controller';
import { RagModule } from './rag/rag.module';
import { SearchController } from './search/search.controller';
import { SourcesService } from './sources/sources.service';

@Module({
  imports: [
    DbModule,
    QueueModule,
    RagModule,
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
  ],
  controllers: [PublicController, ChatController, SearchController, AdminController],
  providers: [
    SourcesService,
    DocumentsService,
    IngestService,
    ConversationsService,
    AnswerService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
