export type Lang = 'ru' | 'uk';

export const LANGUAGE_NAME: Record<Lang, string> = {
  ru: 'Russian',
  uk: 'Ukrainian',
};

const UK_WORDS = new Set(['чи', 'що', 'як', 'та', 'це', 'або', 'мене', 'мені', 'якщо', 'коли', 'можу', 'потрібно', 'який', 'яка', 'скільки', 'де', 'від', 'щоб']);
const RU_WORDS = new Set(['что', 'как', 'это', 'или', 'меня', 'мне', 'если', 'когда', 'могу', 'нужно', 'какой', 'какая', 'сколько', 'где', 'от', 'чтобы', 'ли']);

/**
 * Буквы і ї є ґ есть только в украинском, ы э ё ъ — только в русском. Короткий
 * вопрос может не содержать ни тех, ни других («Чи можу я отримати допомогу?»),
 * поэтому считаем ещё частотные служебные слова. Ничья — подсказка модели, затем русский.
 */
export function detectLang(text: string, hint?: string | null): Lang {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const uk = (text.match(/[іїєґ]/giu) ?? []).length + words.filter((w) => UK_WORDS.has(w)).length;
  const ru = (text.match(/[ыэёъ]/giu) ?? []).length + words.filter((w) => RU_WORDS.has(w)).length;
  if (uk > ru) return 'uk';
  if (ru > uk) return 'ru';
  return hint === 'uk' ? 'uk' : 'ru';
}

export type RefusalReason = 'out_of_scope' | 'low_similarity' | 'no_answer_in_context' | 'no_valid_citations' | 'empty_index';

const REFUSAL: Record<Lang, Record<RefusalReason, string>> = {
  ru: {
    out_of_scope:
      'Я отвечаю только на вопросы о пособии по безработице (Arbeitslosengeld) и оплате профессионального обучения (Bildungsgutschein, Weiterbildung) по официальным документам Bundesagentur für Arbeit. На этот вопрос в моих документах ответа нет.',
    low_similarity:
      'В документах, которые у меня есть, не нашлось фрагмента, который отвечает на этот вопрос. Попробуйте сформулировать иначе или уточните ситуацию.',
    no_answer_in_context:
      'Найденные фрагменты документов не содержат ответа на этот вопрос. Чтобы не ошибиться, я не буду отвечать без источника.',
    no_valid_citations:
      'Не удалось составить ответ со ссылками на документы. Чтобы не ошибиться, я не буду отвечать без источника.',
    empty_index: 'Документы ещё не загружены. Попробуйте позже.',
  },
  uk: {
    out_of_scope:
      'Я відповідаю лише на питання про допомогу з безробіття (Arbeitslosengeld) та оплату професійного навчання (Bildungsgutschein, Weiterbildung) за офіційними документами Bundesagentur für Arbeit. На це питання в моїх документах відповіді немає.',
    low_similarity:
      'У документах, які в мене є, не знайшлося фрагмента, що відповідає на це питання. Спробуйте сформулювати інакше або уточніть ситуацію.',
    no_answer_in_context:
      'Знайдені фрагменти документів не містять відповіді на це питання. Щоб не помилитися, я не відповідатиму без джерела.',
    no_valid_citations:
      'Не вдалося скласти відповідь із посиланнями на документи. Щоб не помилитися, я не відповідатиму без джерела.',
    empty_index: 'Документи ще не завантажені. Спробуйте пізніше.',
  },
};

export function refusalText(lang: Lang, reason: RefusalReason): string {
  return REFUSAL[lang][reason];
}

const DISCLAIMER: Record<Lang, string> = {
  ru: 'Это справка по официальным документам, а не юридическая консультация. Решение по вашему случаю принимает Agentur für Arbeit.',
  uk: 'Це довідка за офіційними документами, а не юридична консультація. Рішення щодо вашої ситуації ухвалює Agentur für Arbeit.',
};

const SOURCES_LABEL: Record<Lang, { sources: string; page: string; version: string }> = {
  ru: { sources: 'Источники', page: 'с.', version: 'редакция' },
  uk: { sources: 'Джерела', page: 'с.', version: 'редакція' },
};

export interface FooterSource {
  title: string;
  page: number;
  docDate: string;
  dateNote: string | null;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Пометка добавляется кодом к каждому ответу, включая отказы. */
export function buildFooter(lang: Lang, sources: FooterSource[]): string {
  const l = SOURCES_LABEL[lang];
  const byTitle = new Map<string, { pages: Set<number>; version: string }>();
  for (const s of sources) {
    const entry = byTitle.get(s.title) ?? { pages: new Set<number>(), version: s.dateNote ?? formatDate(s.docDate) };
    entry.pages.add(s.page);
    byTitle.set(s.title, entry);
  }
  const lines = [...byTitle].map(
    ([title, e]) => `• ${title}, ${l.page} ${[...e.pages].sort((a, b) => a - b).join(', ')} (${l.version}: ${e.version})`,
  );
  return lines.length ? `${DISCLAIMER[lang]}\n${l.sources}:\n${lines.join('\n')}` : DISCLAIMER[lang];
}
