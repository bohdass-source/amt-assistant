import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { env } from '../config/env';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function toMessages(turns: ChatTurn[]): BaseMessage[] {
  return turns.map((t) =>
    t.role === 'system' ? new SystemMessage(t.content) : t.role === 'user' ? new HumanMessage(t.content) : new AIMessage(t.content),
  );
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' && 'text' in p ? String(p.text) : '')).join('');
  }
  return '';
}

/**
 * Генерация через llm-gateway. Гейтвей предполагается OpenAI-совместимым
 * (POST {LLM_BASE_URL}/chat/completions), поэтому тот же клиент работает и
 * с Ollama /v1 — так демо запускается без гейтвея.
 */
@Injectable()
export class LlmService {
  private model(name?: string, temperature = 0.1): ChatOpenAI {
    const e = env();
    return new ChatOpenAI({
      model: name ?? e.LLM_MODEL,
      apiKey: e.LLM_API_KEY,
      configuration: { baseURL: e.LLM_BASE_URL },
      temperature,
      timeout: e.LLM_TIMEOUT_MS,
      maxRetries: 1,
      // Передаётся в тело запроса как есть: Ollama /v1 и большинство гейтвеев понимают reasoning_effort.
      modelKwargs: e.LLM_REASONING_EFFORT ? { reasoning_effort: e.LLM_REASONING_EFFORT } : undefined,
    });
  }

  async complete(turns: ChatTurn[], opts: { model?: string; signal?: AbortSignal } = {}): Promise<string> {
    const res = await this.model(opts.model, 0).invoke(toMessages(turns), { signal: opts.signal });
    return contentToString(res.content);
  }

  async *stream(turns: ChatTurn[], opts: { signal?: AbortSignal } = {}): AsyncGenerator<string> {
    const stream = await this.model().stream(toMessages(turns), { signal: opts.signal });
    for await (const chunk of stream) {
      const text = contentToString(chunk.content);
      if (text) yield text;
    }
  }
}
