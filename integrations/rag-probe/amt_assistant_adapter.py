"""HTTP-адаптер amt-assistant для стенда rag-probe.

Только стандартная библиотека Python 3.10+. Адаптер оборачивает два эндпоинта:

* ``retrieve`` → ``POST /api/search`` — поиск без генерации (основной режим стенда);
* ``answer``   → ``POST /api/chat``   — полный ответ со сносками (SSE, гостевой токен).

Интерфейс адаптера rag-probe здесь не импортируется: класс отдаёт простые словари,
и тонкая обёртка под конкретный базовый класс стенда занимает несколько строк
(см. README рядом).

Пример::

    adapter = AmtAssistantAdapter("https://amt.example.org", api_key=os.getenv("SEARCH_API_KEY"))
    hits = adapter.retrieve("Получу ли я пособие, если сам уволился?", k=5)
    print(hits[0]["document_id"], hits[0]["page"])
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AmtAssistantAdapter:
    base_url: str = "http://localhost:3001"
    api_key: str | None = None
    timeout: float = 120.0
    translate: bool = True
    name: str = "amt-assistant"
    _token: str | None = field(default=None, init=False, repr=False)

    # ── retrieval ────────────────────────────────────────────────────────────
    def search(self, query: str, k: int = 10, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
        """Полный ответ /api/search: query_de, refused, results[…]."""
        payload = {"query": query, "k": k, "translate": self.translate, "history": history or []}
        headers = {"x-api-key": self.api_key} if self.api_key else {}
        return self._post_json("/api/search", payload, headers)

    def retrieve(self, query: str, k: int = 10) -> list[dict[str, Any]]:
        """Список фрагментов в порядке RRF. Пустой список, если система отказалась."""
        body = self.search(query, k)
        if body.get("refused"):
            return []
        return [
            {
                "chunk_id": r["chunk_id"],
                "document_id": r["document_id"],
                "text": r["text"],
                "score": r["score"],
                "rank": r["rank"],
                "metadata": {
                    "title": r["title"],
                    "url": r["url"],
                    "page": r["page"],
                    "section": r["section"],
                    "doc_date": r["doc_date"],
                    "vector_rank": r["vector_rank"],
                    "vector_similarity": r["vector_similarity"],
                    "keyword_rank": r["keyword_rank"],
                },
                "page": r["page"],
            }
            for r in body["results"]
        ]

    # ── generation ───────────────────────────────────────────────────────────
    def answer(self, question: str) -> dict[str, Any]:
        """Ответ чата: answer, citations[…], refused, refusal_reason, footer."""
        if self._token is None:
            self._token = self._post_json("/api/auth/guest", {}, {})["token"]
        req = urllib.request.Request(
            self.base_url.rstrip("/") + "/api/chat",
            data=json.dumps({"message": question}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310 — URL задаёт оператор стенда
            raw = res.read().decode("utf-8")
        done: dict[str, Any] | None = None
        for block in raw.split("\n\n"):
            event = next((ln[7:] for ln in block.splitlines() if ln.startswith("event: ")), None)
            data = next((ln[6:] for ln in block.splitlines() if ln.startswith("data: ")), None)
            if event == "error":
                raise RuntimeError(f"amt-assistant chat error: {data}")
            if event == "done" and data:
                done = json.loads(data)
        if done is None:
            raise RuntimeError("amt-assistant: stream ended without a done event")
        return {
            "answer": done["answer"],
            "refused": done["refused"],
            "refusal_reason": done["refusalReason"],
            "citations": done["citations"],
            "footer": done["footer"],
            "contexts": [c["snippet"] for c in done["citations"]],
        }

    # ── http ─────────────────────────────────────────────────────────────────
    def _post_json(self, path: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        req = urllib.request.Request(
            self.base_url.rstrip("/") + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"amt-assistant {path}: HTTP {err.code} {err.read()[:300]!r}") from err


if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Smoke test for the amt-assistant adapter")
    parser.add_argument("query")
    parser.add_argument("--url", default=os.getenv("AMT_URL", "http://localhost:3001"))
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--answer", action="store_true", help="also call /api/chat")
    args = parser.parse_args()

    adapter = AmtAssistantAdapter(args.url, api_key=os.getenv("SEARCH_API_KEY"))
    for hit in adapter.retrieve(args.query, args.k):
        print(f"{hit['rank']:>2}. {hit['chunk_id']:<40} {hit['score']:.4f}  {hit['metadata']['title'][:60]}")
    if args.answer:
        print(json.dumps(adapter.answer(args.query), ensure_ascii=False, indent=2))
