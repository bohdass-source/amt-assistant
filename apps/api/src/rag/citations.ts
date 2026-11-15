export const NO_ANSWER = 'NO_ANSWER';

export interface CitationCheck {
  /** Ответ, в котором оставлены только сноски на переданные фрагменты. */
  text: string;
  /** Номера фрагментов (с 1), на которые ответ реально ссылается. */
  used: number[];
  /** Номера, которых не было в контексте — модель их выдумала, они удалены. */
  invalid: number[];
  /** Модель сама сообщила, что в контексте ответа нет. */
  noAnswer: boolean;
}

const CITATION = /\[\s*(\d+(?:\s*[,;]\s*\d+)*)\s*\]/g;

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '');
}

/**
 * Проверка сносок кодом, а не моделью: каждая [n] должна указывать на один из
 * фрагментов 1..fragmentCount, переданных в промпт. Чужие номера удаляются.
 */
export function checkCitations(answer: string, fragmentCount: number): CitationCheck {
  const cleaned = stripThinking(answer).trim();
  const withoutMarker = cleaned.replace(/\bNO_ANSWER\b/g, '').trim();
  if (cleaned.includes(NO_ANSWER) && withoutMarker.length < 40) {
    return { text: '', used: [], invalid: [], noAnswer: true };
  }

  const used = new Set<number>();
  const invalid = new Set<number>();
  const text = withoutMarker
    .replace(CITATION, (_m, inner: string) => {
      const nums = inner.split(/[,;]/).map((s) => Number(s.trim()));
      const ok = [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= fragmentCount))];
      for (const n of nums) if (!ok.includes(n)) invalid.add(n);
      for (const n of ok) used.add(n);
      return ok.map((n) => `[${n}]`).join('');
    })
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return {
    text,
    used: [...used].sort((a, b) => a - b),
    invalid: [...invalid].sort((a, b) => a - b),
    noAnswer: false,
  };
}

/**
 * Убирает блоки <think>…</think> из потока токенов. Тег может прийти разрезанным
 * между чанками, поэтому хвост, похожий на начало тега, придерживается до следующего push.
 */
export class ThinkStreamFilter {
  private buf = '';
  private inThink = false;

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>');
        if (end === -1) {
          this.buf = this.buf.slice(-7);
          return out;
        }
        this.buf = this.buf.slice(end + '</think>'.length);
        this.inThink = false;
        continue;
      }
      const start = this.buf.indexOf('<think>');
      if (start === -1) {
        const hold = partialTagSuffix(this.buf, '<think>');
        out += this.buf.slice(0, this.buf.length - hold);
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      out += this.buf.slice(0, start);
      this.buf = this.buf.slice(start + '<think>'.length);
      this.inThink = true;
    }
  }

  flush(): string {
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

function partialTagSuffix(s: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, s.length); len > 0; len--) {
    if (tag.startsWith(s.slice(-len))) return len;
  }
  return 0;
}
