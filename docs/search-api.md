# `POST /api/search`: retrieval without generation

Endpoint for the rag-probe test bench and any external evaluator. It returns exactly
what the answer generator would receive: the German rewrite of the question, the
refusal decision and the fused (RRF) list of excerpts. No LLM is called to answer.

If `SEARCH_API_KEY` is set, the `x-api-key` header is required.
Rate limit: 60 requests per minute per IP.

## Request

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

| field       | type    | default | meaning                                                                                    |
|-------------|---------|---------|--------------------------------------------------------------------------------------------|
| `query`     | string  | —       | question in Russian, Ukrainian or German (2–2000 characters)                              |
| `k`         | int     | 10      | number of excerpts to return (1–50); each retriever always fetches at least 20 candidates |
| `translate` | bool    | true    | `false` skips the LLM rewrite and topic check: a deterministic retriever-only run          |
| `history`   | array   | []      | previous turns, used to resolve follow-ups such as "and if I am 58?"                       |

## Response

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

- `chunk_id` is stable across re-indexing as long as the PDF does not change:
  `<document_id>#p<page>-<n>`. It can be used in qrels.
- `page` is the page number **in the PDF file** (from 1), not the number printed on the sheet.
- `refused` and `refusal_reason` (`out_of_scope`, `low_similarity`, `empty_index`) are the same
  decision the chat makes before generation. Refusals by the model itself
  (`no_answer_in_context`, `no_valid_citations`) are visible only in the chat.
- `vector_rank` / `keyword_rank` are the ranks in the input lists (Chroma and PostgreSQL FTS),
  or `null`.
