# `POST /api/search` — поиск без генерации

Эндпоинт для стенда rag-probe и любых внешних оценщиков. Возвращает ровно то, что
получил бы генератор ответа: перевод вопроса на немецкий, решение об отказе и
слитый (RRF) список фрагментов. LLM для ответа не вызывается.

Если в окружении задан `SEARCH_API_KEY`, нужен заголовок `x-api-key`.
Лимит: 60 запросов в минуту с одного IP.

## Запрос

```json
{
  "query": "Получу ли я пособие, если сам уволился?",
  "k": 5,
  "translate": true,
  "history": [
    { "role": "user", "content": "Сколько платят пособие?" },
    { "role": "assistant", "content": "60 % … [1]" }
  ]
}
```

| поле        | тип     | по умолчанию | смысл                                                                                       |
|-------------|---------|--------------|---------------------------------------------------------------------------------------------|
| `query`     | string  | —            | вопрос на русском, украинском или немецком (2–2000 символов)                               |
| `k`         | int     | 10           | сколько фрагментов вернуть (1–50); каждый ретривер всегда достаёт ≥ 20 кандидатов          |
| `translate` | bool    | true         | `false` — без LLM-перевода и проверки темы: детерминированный прогон только ретривера       |
| `history`   | array   | []           | предыдущие реплики для разрешения ссылок («а если мне 58?»)                                 |

## Ответ

```json
{
  "query": "Получу ли я пособие, если сам уволился?",
  "lang": "ru",
  "query_de": "Sperrzeit Arbeitslosengeld bei Eigenkündigung Arbeitsaufgabe",
  "rewritten": true,
  "in_scope": true,
  "top_similarity": 0.71,
  "refused": false,
  "refusal_reason": null,
  "results": [
    {
      "rank": 1,
      "chunk_id": "ba-fw-159#p6-1",
      "document_id": "ba-fw-159",
      "title": "Fachliche Weisungen § 159 SGB III – Ruhen bei Sperrzeit",
      "url": "https://www.arbeitsagentur.de/datei/fw-sgb-iii-159_ba034410.pdf#page=6",
      "page": 6,
      "section": "§ 159 SGB III",
      "doc_date": "2026-07-01",
      "text": "…",
      "score": 0.032787,
      "vector_rank": 1,
      "vector_similarity": 0.7104,
      "keyword_rank": 2
    }
  ],
  "timings_ms": { "rewrite": 820, "search": 95, "total": 930 }
}
```

- `chunk_id` стабилен между переиндексациями, пока не меняется PDF: `<document_id>#p<страница>-<n>`.
  Его можно использовать в qrels.
- `page` — номер страницы **в PDF-файле** (с 1), а не напечатанный на листе.
- `refused` и `refusal_reason` (`out_of_scope`, `low_similarity`, `empty_index`) — то же
  решение, которое чат принимает до генерации. Отказы самой модели (`no_answer_in_context`,
  `no_valid_citations`) видны только в чате.
- `vector_rank` / `keyword_rank` — ранги в исходных списках (Chroma и PostgreSQL FTS) или `null`.
