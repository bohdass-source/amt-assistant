import { describe, expect, it } from 'vitest';
import { QueryRewriterService } from '../../src/rag/query-rewriter.service';
import type { LlmService } from '../../src/rag/llm.service';
import { FakeLlm } from './fakes';

const QUESTION = 'Получу ли я пособие, если сам уволился?';

describe('QueryRewriterService with a fake model', () => {
  it('uses the German query and the scope decision from the model', async () => {
    const llm = new FakeLlm('{"lang":"ru","in_scope":true,"query_de":"Sperrzeit bei Eigenkündigung"}');
    const r = await new QueryRewriterService(llm.asService()).rewrite(QUESTION, [{ role: 'user', content: 'Сколько платят?' }]);

    expect(r).toEqual({ lang: 'ru', inScope: true, queryDe: 'Sperrzeit bei Eigenkündigung', rewritten: true });
    expect(llm.calls[0].turns[1].content).toContain('Conversation so far:\nUser: Сколько платят?');
  });

  it('falls back to the original question when the model returns garbage', async () => {
    const r = await new QueryRewriterService(new FakeLlm('Sorry, I cannot help').asService()).rewrite(QUESTION, []);
    expect(r).toEqual({ lang: 'ru', inScope: true, queryDe: QUESTION, rewritten: false });
  });

  it('falls back to the original question when the model call fails', async () => {
    const failing = { complete: async () => Promise.reject(new Error('timeout')) } as unknown as LlmService;
    const r = await new QueryRewriterService(failing).rewrite(QUESTION, []);
    expect(r.rewritten).toBe(false);
  });

  it('rethrows when the request was aborted by the user', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const failing = { complete: async () => Promise.reject(new Error('aborted')) } as unknown as LlmService;
    await expect(new QueryRewriterService(failing).rewrite(QUESTION, [], ctrl.signal)).rejects.toThrow('aborted');
  });
});
