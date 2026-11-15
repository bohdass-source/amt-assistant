import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/auth.guards';
import { ZodPipe } from '../common/zod.pipe';
import { AnswerService, type ChatEvent } from './answer.service';
import { ConversationsService } from './conversations.service';

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(2).max(2000),
});

const ratingSchema = z.object({
  score: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1000).optional(),
});

@Controller()
@UseGuards(AuthGuard)
export class ChatController {
  private readonly log = new Logger(ChatController.name);

  constructor(
    private readonly answers: AnswerService,
    private readonly conversations: ConversationsService,
  ) {}

  /** Server-Sent Events over POST: meta → sources → token… → done (or error). */
  @Post('chat')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async chat(
    @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (e: ChatEvent | { event: 'error'; data: { message: string } }) => {
      if (!res.writableEnded) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };

    try {
      await this.answers.run({ userId: user.id, conversationId: body.conversationId, message: body.message, signal: abort.signal }, send);
    } catch (err) {
      if (!abort.signal.aborted) {
        this.log.error(`chat failed for ${req.ip}: ${(err as Error).stack ?? err}`);
        const status = (err as { status?: number }).status;
        send({ event: 'error', data: { message: status && status < 500 ? (err as Error).message : 'internal_error' } });
      }
    } finally {
      res.end();
    }
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.id);
  }

  @Get('conversations/:id')
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.messages(user.id, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.conversations.remove(user.id, id);
  }

  @Post('messages/:id/rating')
  @HttpCode(204)
  async rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ratingSchema)) body: z.infer<typeof ratingSchema>,
  ) {
    await this.conversations.rate(user.id, id, body.score, body.comment ?? null);
  }
}
