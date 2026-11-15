import { describe, expect, it } from 'vitest';
import { AnswerService, type ChatEvent } from '../../src/chat/answer.service';
import { refusalText } from '../../src/rag/i18n';
import { FakeConversations, FakeLlm, fakeRetrieval, retrievalResult } from './fakes';

async function run(reply: string, result = retrievalResult()) {
  const llm = new FakeLlm(reply);
  const conversations = new FakeConversations();
  const service = new AnswerService(fakeRetrieval(result), llm.asService(), conversations.asService());
  const events: ChatEvent[] = [];
  await service.run({ userId: 'u1', message: result.question }, (e) => events.push(e));
  const done = events.find((e) => e.event === 'done');
  if (done?.event !== 'done') throw new Error('no done event');
  const streamed = events.flatMap((e) => (e.event === 'token' ? [e.data.text] : [])).join('');
  return { llm, conversations, events, done: done.data, streamed };
}

describe('AnswerService with a fake model', () => {
  it('keeps valid footnotes, removes invented ones and cites only used excerpts', async () => {
    const { done, conversations } = await run('Пособие не платят 12 недель [2]. Детали в памятке [9].');

    expect(done.answer).toBe('Пособие не платят 12 недель [2]. Детали в памятке.');
    expect(done.invalidCitations).toEqual([9]);
    expect(done.refused).toBe(false);
    expect(done.citations.map((c) => c.n)).toEqual([2]);
    expect(done.footer).toContain('не юридическая консультация');
    expect(done.footer).toContain('Merkblatt 2, с. 2');
    expect(conversations.saved[0]).toMatchObject({ content: done.answer, refused: false });
  });

  it('sends the excerpts and the German query to the model', async () => {
    const { llm, events } = await run('Ответ [1].');

    const [system, user] = llm.calls[0].turns;
    expect(system.content).toContain('[1] «Merkblatt 1», PDF page 1');
    expect(system.content).toContain('Answer in Russian');
    expect(user.content).toContain('Standalone question in German: Sperrzeit Eigenkündigung');
    const order = events.map((e) => e.event);
    expect(order.slice(0, 2)).toEqual(['meta', 'sources']);
    expect(order.at(-1)).toBe('done');
    expect(new Set(order.slice(2, -1))).toEqual(new Set(['token']));
  });

  it('turns NO_ANSWER into a refusal without streaming the marker', async () => {
    const { done, streamed } = await run('NO_ANSWER');

    expect(streamed).toBe('');
    expect(done.refused).toBe(true);
    expect(done.refusalReason).toBe('no_answer_in_context');
    expect(done.answer).toBe(refusalText('ru', 'no_answer_in_context'));
    expect(done.citations).toEqual([]);
  });

  it('refuses an answer that has no valid footnote', async () => {
    const { done } = await run('Пособие платят всем без исключений. [7]');

    expect(done.refused).toBe(true);
    expect(done.refusalReason).toBe('no_valid_citations');
    expect(done.invalidCitations).toEqual([7]);
  });

  it('does not call the model when retrieval already refused', async () => {
    const { done, llm } = await run(
      'unused',
      // Excerpts were found, but the question is off-topic: the refusal must still win.
      retrievalResult({ lang: 'uk', refused: true, refusalReason: 'out_of_scope' }),
    );

    expect(llm.calls).toHaveLength(0);
    expect(done.refusalReason).toBe('out_of_scope');
    expect(done.answer).toBe(refusalText('uk', 'out_of_scope'));
    expect(done.footer).toContain('не юридична консультація');
  });

  it('never streams reasoning blocks', async () => {
    const { streamed, done } = await run('<think>Нужно найти [5] и [6]</think>Срок — 12 недель [1].');

    expect(streamed).not.toContain('think');
    expect(streamed).not.toContain('[5]');
    expect(done.answer).toBe('Срок — 12 недель [1].');
    expect(done.invalidCitations).toEqual([]);
  });
});
