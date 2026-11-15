import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { env, redisConnection } from '../config/env';
import { INGEST_QUEUE } from './ingest.constants';

/** Redis connection and queue registration, shared by the API (producer) and the worker (consumer). */
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection(env().REDIS_URL) }),
    BullModule.registerQueue({ name: INGEST_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
