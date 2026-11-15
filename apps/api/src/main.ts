import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const e = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.setGlobalPrefix('api');
  // Behind Caddy: req.ip must be the client address for rate limiting.
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({ origin: e.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: false });
  app.enableShutdownHooks();
  await app.listen(e.PORT, '0.0.0.0');
  Logger.log(`API listening on :${e.PORT}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
