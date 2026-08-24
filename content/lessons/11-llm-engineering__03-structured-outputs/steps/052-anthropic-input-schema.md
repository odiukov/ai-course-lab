---
id: 052-anthropic-input-schema
type: theory
title: 'Anthropic: схема внутри input_schema инструмента'
source_anchor: '### Anthropic Tool Use'
---

Ты только что видел, как в OpenAI это выглядит одной строкой: `response_format=Product`, и в ответе лежит `.parsed` ([шаг 51](#step-51)). Открываешь документацию Anthropic, ищешь такое же поле — и не находишь. Нет `response_format`, нет `json_schema` рядом с `messages`. Значит, схему передать некуда?

Есть куда. Только вход в API другой: схема живёт внутри описания инструмента, в поле `input_schema`.

```python
tools = [{
    "name": "save_product",
    "description": "Сохранить данные о товаре",
    "input_schema": {
        "type": "object",
        "properties": {
            "name":     {"type": "string"},
            "price":    {"type": "number", "minimum": 0},
            "in_stock": {"type": "boolean"},
        },
        "required": ["name", "price", "in_stock"],
    },
}]

response = client.messages.create(
    model="claude-sonnet-5",
    max_tokens=1024,
    tools=tools,
    tool_choice={"type": "tool", "name": "save_product"},
    messages=[{"role": "user", "content": text}],
)

product = response.content[0].input   # уже dict
```

Присмотрись к `input_schema`: это ровно тот же JSON Schema, который ты собирал руками в [шагах 12](#step-12)–[14](#step-14) — `type`, `properties`, `required`, `minimum: 0`. Ничего нового учить не нужно, поменялось только место, куда его положить.

Ключевая строчка — `tool_choice`. Без неё модель сама решает, вызывать инструмент или ответить текстом, и ты снова оказываешься с прозой на входе парсера. С `{"type": "tool", "name": "save_product"}` вызов обязателен.

И самое приятное: `response.content[0].input` — это уже готовый `dict`. Ни заборчика из бэктиков, ни преамбулы ([шаг 16](#step-16)), ни `strip_code_fence`, ни `parse_llm_json`.

Никакой функции `save_product` в твоём коде при этом может не быть вовсе. Инструмент здесь — не действие, а форма для аргументов.

> 🎒 **На пальцах.** Вызываешь такси, но сам не садишься: отдаёшь водителю посылку и закрываешь дверь. Машина нужна была не чтобы везти тебя, а чтобы у посылки появился адрес и багажник. Инструмент в Anthropic — та же машина: объявляешь его, обязываешь модель «вызвать», а сам берёшь только `input` — то, что она положила в багажник. Ехать никуда не надо.
