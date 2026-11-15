'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type UiLang = 'ru' | 'uk';

const STRINGS = {
  ru: {
    tagline: 'Ответы по официальным документам о пособии по безработице и оплате обучения',
    navChat: 'Чат',
    navSources: 'Источники',
    navAdmin: 'Админ',
    disclaimer:
      'Это справка по официальным документам Bundesagentur für Arbeit, а не юридическая консультация. Решение по вашему случаю принимает Agentur für Arbeit. Дата редакции указана у каждого источника.',
    newChat: 'Новый диалог',
    history: 'История',
    noHistory: 'Здесь появятся ваши диалоги',
    placeholder: 'Задайте вопрос по-русски или по-украински…',
    send: 'Отправить',
    stop: 'Стоп',
    welcomeTitle: 'Спросите о пособии или оплате обучения',
    welcomeText:
      'Я ищу ответ в 20 официальных документах Bundesagentur für Arbeit и отвечаю только тем, что в них написано, со ссылкой на документ и страницу.',
    examples: [
      'Сколько месяцев платят пособие, если мне 58 лет?',
      'Получу ли я пособие, если сам уволился?',
      'Что такое Bildungsgutschein и как его получить?',
      'Сколько можно подрабатывать, пока получаю пособие?',
    ],
    sources: 'Источники',
    citeLabel: 'Источник',
    sourcesEmpty: 'Здесь появятся фрагменты документов, на которые опирается ответ.',
    page: 'стр.',
    version: 'редакция',
    openPdf: 'Открыть PDF на этой странице',
    searching: 'Ищу в документах…',
    helpful: 'Ответ полезен',
    notHelpful: 'Ответ неверный или бесполезный',
    thanks: 'Спасибо за оценку',
    error: 'Не удалось получить ответ. Попробуйте ещё раз.',
    refused: 'Без ответа',
    deleteChat: 'Удалить диалог',
    corpusTitle: 'Документы, по которым я отвечаю',
    corpusText: 'Все документы опубликованы Bundesagentur für Arbeit или на gesetze-im-internet.de. Ведомства регулярно обновляют их — сверяйте дату редакции.',
    status: 'Статус',
    pages: 'Страниц',
  },
  uk: {
    tagline: 'Відповіді за офіційними документами про допомогу з безробіття та оплату навчання',
    navChat: 'Чат',
    navSources: 'Джерела',
    navAdmin: 'Адмін',
    disclaimer:
      'Це довідка за офіційними документами Bundesagentur für Arbeit, а не юридична консультація. Рішення щодо вашої ситуації ухвалює Agentur für Arbeit. Дата редакції вказана біля кожного джерела.',
    newChat: 'Новий діалог',
    history: 'Історія',
    noHistory: 'Тут з’являться ваші діалоги',
    placeholder: 'Поставте питання українською або російською…',
    send: 'Надіслати',
    stop: 'Стоп',
    welcomeTitle: 'Запитайте про допомогу або оплату навчання',
    welcomeText:
      'Я шукаю відповідь у 20 офіційних документах Bundesagentur für Arbeit і відповідаю лише тим, що в них написано, з посиланням на документ і сторінку.',
    examples: [
      'Скільки місяців виплачують допомогу, якщо мені 58 років?',
      'Чи отримаю я допомогу, якщо звільнився сам?',
      'Що таке Bildungsgutschein і як його отримати?',
      'Чи оплачує агентство проїзд під час навчання?',
    ],
    sources: 'Джерела',
    citeLabel: 'Джерело',
    sourcesEmpty: 'Тут з’являться фрагменти документів, на які спирається відповідь.',
    page: 'с.',
    version: 'редакція',
    openPdf: 'Відкрити PDF на цій сторінці',
    searching: 'Шукаю в документах…',
    helpful: 'Відповідь корисна',
    notHelpful: 'Відповідь неправильна або некорисна',
    thanks: 'Дякуємо за оцінку',
    error: 'Не вдалося отримати відповідь. Спробуйте ще раз.',
    refused: 'Без відповіді',
    deleteChat: 'Видалити діалог',
    corpusTitle: 'Документи, за якими я відповідаю',
    corpusText: 'Усі документи опубліковані Bundesagentur für Arbeit або на gesetze-im-internet.de. Відомства регулярно їх оновлюють — звіряйте дату редакції.',
    status: 'Статус',
    pages: 'Сторінок',
  },
} as const;

export type Strings = (typeof STRINGS)[UiLang];

const LangContext = createContext<{ lang: UiLang; t: Strings; setLang: (l: UiLang) => void }>({
  lang: 'ru',
  t: STRINGS.ru,
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>('ru');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('amt.lang');
      if (saved === 'ru' || saved === 'uk') setLangState(saved);
      else if (navigator.language.startsWith('uk')) setLangState('uk');
    } catch {
      /* private mode: stay on Russian */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: UiLang) => {
    setLangState(l);
    try {
      localStorage.setItem('amt.lang', l);
    } catch {
      /* ignore */
    }
  };

  return <LangContext.Provider value={{ lang, t: STRINGS[lang], setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
