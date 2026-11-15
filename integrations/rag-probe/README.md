# amt-assistant в стенде rag-probe

`amt_assistant_adapter.py` — второй адаптер стенда: он ходит в работающий
amt-assistant по HTTP, а не импортирует его код. Так стенд проверяет проект
целиком (перевод вопроса, гибридный поиск, порог отказа) в том виде, в каком
он развёрнут.

## Подключение

1. Скопируйте файл в каталог адаптеров стенда (или добавьте этот каталог в `PYTHONPATH`).
2. Оберните класс под базовый интерфейс стенда. Ретривер обычно выглядит так:

```python
from amt_assistant_adapter import AmtAssistantAdapter

class AmtAssistantRetriever(BaseRetriever):          # базовый класс rag-probe
    name = "amt-assistant-http"

    def __init__(self, base_url: str, api_key: str | None = None, k: int = 10):
        self.client = AmtAssistantAdapter(base_url, api_key=api_key)
        self.k = k

    def retrieve(self, question: str, k: int | None = None):
        return self.client.retrieve(question, k or self.k)
```

3. Корпус для qrels: ID фрагментов имеют вид `<document_id>#p<страница>-<n>`
   (см. `docs/search-api.md`). Для оценки на уровне документа используйте
   `document_id`, на уровне страницы — пару `document_id` + `page`.

## Режимы

| режим                              | что проверяет                                   |
|------------------------------------|-------------------------------------------------|
| `translate=True` (по умолчанию)    | весь путь: LLM-перевод на немецкий + поиск      |
| `translate=False`                  | только ретривер, детерминированно, без LLM      |
| `answer()`                         | ответ, сноски, отказы модели                    |

## Быстрая проверка

```bash
python3 integrations/rag-probe/amt_assistant_adapter.py "Что такое Bildungsgutschein?" --url http://localhost:3001
```
