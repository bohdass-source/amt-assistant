import { Injectable, Logger } from '@nestjs/common';
import { checkCitations, NO_ANSWER, ThinkStreamFilter } from '../rag/citations';
import { buildFooter, refusalText, type Lang, type RefusalReason } from '../rag/i18n';
import { LlmService } from '../rag/llm.service';
import { answerSystemPrompt, type PromptFragment } from '../rag/prompts';
import { RetrievalService, type Hit } from '../rag/retrieval.service';
import { ConversationsService, type Citation } from './conversations.service';

export type ChatEvent =
  | { event: 'meta'; data: { conversationId: string; userMessageId: string; lang: Lang; queryDe: string } }
  | { event: 'sources'; data: { fragments: Citation[] } }
  | { event: 'token'; data: { text: string } }
  | {
      event: 'done';
      data: {
        messageId: string;
        answer: string;
        citations: Citation[];
        footer: string;
        refused: boolean;
        refusalReason: RefusalReason | null;
        invalidCitations: number[];
      };
    };

export type Emit = (e: ChatEvent) => void;

const toCitation = (h: Hit, n: number): Citation => ({
  n,
  chunkId: h.chunkId,
  documentId: h.documentId,
  title: h.title,
  url: h.url,
  page: h.page,
  section: h.section,
  docDate: h.docDate,
  dateNote: h.dateNote,
  snippet: h.text.length > 700 ? `${h.text.slice(0, 700)}…` : h.text,
});

@Injectable()
export class AnswerService {
  private readonly log = new Logger(AnswerService.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmService,
    private readonly conversations: ConversationsService,
  ) {}

  async run(input: { userId: string; conversationId?: string; message: string; signal?: AbortSignal }, emit: Emit) {
    const conversationId = await this.conversations.getOrCreate(input.userId, input.conversationId, input.message);
    const history = await this.conversations.history(conversationId);
    const userMessageId = await this.conversations.addUserMessage(conversationId, input.message);

    const r = await this.retrieval.retrieve(input.message, { history, signal: input.signal });
    emit({ event: 'meta', data: { conversationId, userMessageId, lang: r.lang, queryDe: r.queryDe } });

    const finish = async (answer: string, citations: Citation[], refusal: RefusalReason | null, invalid: number[] = []) => {
      const footer = buildFooter(r.lang, citations);
      const messageId = await this.conversations.addAssistantMessage({
        conversationId,
        content: answer,
        lang: r.lang,
        queryDe: r.queryDe,
        citations,
        footer,
        refused: refusal !== null,
        refusalReason: refusal,
      });
      emit({
        event: 'done',
        data: { messageId, answer, citations, footer, refused: refusal !== null, refusalReason: refusal, invalidCitations: invalid },
      });
    };

    if (r.refused || r.hits.length === 0) {
      const reason = r.refusalReason ?? 'low_similarity';
      return finish(refusalText(r.lang, reason), [], reason);
    }

    const fragments = r.hits.map((h, i) => toCitation(h, i + 1));
    emit({ event: 'sources', data: { fragments } });

    const promptFragments: PromptFragment[] = r.hits.map((h, i) => ({
      n: i + 1,
      title: h.title,
      page: h.page,
      docDate: h.docDate,
      dateNote: h.dateNote,
      section: h.section,
      text: h.text,
    }));

    // Первые символы придерживаем: если модель отвечает NO_ANSWER, пользователь не увидит маркер.
    const filter = new ThinkStreamFilter();
    let raw = '';
    let pending = '';
    let streaming = false;
    const forward = (visible: string) => {
      if (!visible) return;
      if (streaming) return emit({ event: 'token', data: { text: visible } });
      pending += visible;
      const head = pending.trimStart();
      if (head.length >= NO_ANSWER.length) {
        if (head.startsWith(NO_ANSWER)) return;
        streaming = true;
        emit({ event: 'token', data: { text: pending } });
      }
    };

    // Историю в генерацию не передаём: в старых ответах есть сноски [n] на другие
    // фрагменты, и модель путает нумерацию. Контекст диалога уже учтён в query_de.
    const question = r.rewritten ? `${input.message}\n\n(Standalone question in German: ${r.queryDe})` : input.message;
    for await (const token of this.llm.stream(
      [
        { role: 'system', content: answerSystemPrompt(r.lang, promptFragments) },
        { role: 'user', content: question },
      ],
      { signal: input.signal },
    )) {
      raw += token;
      forward(filter.push(token));
    }
    forward(filter.flush());

    const check = checkCitations(raw, fragments.length);
    if (check.invalid.length) this.log.warn(`Removed invented citations ${check.invalid.join(',')} in ${conversationId}`);
    if (check.noAnswer) return finish(refusalText(r.lang, 'no_answer_in_context'), [], 'no_answer_in_context');
    if (check.used.length === 0) return finish(refusalText(r.lang, 'no_valid_citations'), [], 'no_valid_citations', check.invalid);

    const cited = fragments.filter((f) => check.used.includes(f.n));
    return finish(check.text, cited, null, check.invalid);
  }
}
