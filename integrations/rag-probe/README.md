# amt-assistant in the rag-probe test bench

`amt_assistant_adapter.py` is the bench's second adapter: it calls a running
amt-assistant over HTTP instead of importing its code. That way the bench tests the
whole project (query rewrite, hybrid retrieval, refusal threshold) as it is deployed.

## Setup

1. Copy the file into the bench's adapters directory (or add this directory to `PYTHONPATH`).
2. Wrap the class in the bench's base interface. A retriever usually looks like this:

```python
from amt_assistant_adapter import AmtAssistantAdapter

class AmtAssistantRetriever(BaseRetriever):          # rag-probe base class
    name = "amt-assistant-http"

    def __init__(self, base_url: str, api_key: str | None = None, k: int = 10):
        self.client = AmtAssistantAdapter(base_url, api_key=api_key)
        self.k = k

    def retrieve(self, question: str, k: int | None = None):
        return self.client.retrieve(question, k or self.k)
```

3. Qrels: chunk ids look like `<document_id>#p<page>-<n>` (see
   [`docs/search-api.md`](../../docs/search-api.md)). For document-level scoring use
   `document_id`; for page-level scoring use the pair `document_id` + `page`.

## Modes

| mode                            | what it tests                                    |
|---------------------------------|--------------------------------------------------|
| `translate=True` (default)      | the full path: LLM rewrite into German + search  |
| `translate=False`               | the retriever only, deterministic, no LLM        |
| `answer()`                      | the answer, its footnotes and model refusals     |

## Smoke test

Requires a running API (see the main README).

```bash
python3 integrations/rag-probe/amt_assistant_adapter.py "Что такое Bildungsgutschein?" --url http://localhost:3001
```
