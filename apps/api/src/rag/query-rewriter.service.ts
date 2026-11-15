import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '../config/env';
import { stripThinking } from './citations';
import { detectLang, type Lang } from './i18n';
import { LlmService } from './llm.service';
import { REWRITE_SYSTEM, rewriteUserPrompt, type HistoryTurn } from './prompts';

export interface RewriteResult {
  lang: Lang;
  inScope: boolean;
  queryDe: string;
  /** false — модель не ответила или вернула мусор, использован исходный вопрос. */
  rewritten: boolean;
}

// Для вопроса вне темы модель часто оставляет query_de пустым — это валидный ответ, а не мусор.
const rewriteSchema = z
  .object({
    lang: z.string().optional(),
    in_scope: z.boolean(),
    query_de: z.string().max(400).default(''),
  })
  .refine((r) => !r.in_scope || r.query_de.trim().length >= 3, { message: 'query_de required when in_scope' });

export function parseRewrite(raw: string): z.infer<typeof rewriteSchema> | null {
  const text = stripThinking(raw).replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = rewriteSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

@Injectable()
export class QueryRewriterService {
  private readonly log = new Logger(QueryRewriterService.name);

  constructor(private readonly llm: LlmService) {}

  async rewrite(question: string, history: HistoryTurn[], signal?: AbortSignal): Promise<RewriteResult> {
    try {
      const raw = await this.llm.complete(
        [
          { role: 'system', content: REWRITE_SYSTEM },
          { role: 'user', content: rewriteUserPrompt(question, history) },
        ],
        { model: env().LLM_REWRITE_MODEL, signal },
      );
      const parsed = parseRewrite(raw);
      if (parsed) {
        return {
          lang: detectLang(question, parsed.lang),
          inScope: parsed.in_scope,
          queryDe: parsed.query_de.trim() || question,
          rewritten: true,
        };
      }
      this.log.warn(`Unparseable rewrite output: ${raw.slice(0, 200)}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      this.log.warn(`Rewrite failed, falling back to original question: ${(err as Error).message}`);
    }
    // Без перевода: bge-m3 мультиязычный, векторный поиск всё ещё работает.
    return { lang: detectLang(question), inScope: true, queryDe: question, rewritten: false };
  }
}
