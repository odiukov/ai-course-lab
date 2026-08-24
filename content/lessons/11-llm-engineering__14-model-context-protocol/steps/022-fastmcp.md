---
id: 022-fastmcp
type: theory
title: 'FastMCP: три декоратора и ноль строк JSON Schema'
source_anchor: '### Step 1: a minimal MCP server'
---

Вернись на минуту к конвертам, которые ты собирал руками в [шаге 10](#step-10) и [шаге 12](#step-12). Теперь представь, что host спросил `tools/list`, и тебе надо ответить: имя `add`, описание словами, а внутри — `inputSchema` с двумя полями, у каждого тип `integer`, и список обязательных. Для одного инструмента это десяток строк. Для трёх — тридцать. И каждый раз, добавив третий аргумент в функцию, ты обязан вспомнить и починить схему.

А ведь всё это уже написано. Где?

В самой сигнатуре функции. `def add(a: int, b: int) -> int` — здесь уже сказано: два аргумента, оба целые. А зачем инструмент нужен, ты честно пишешь в докстроке. Официальный Python SDK называется `mcp`, и его высокоуровневый помощник `FastMCP` просто читает то, что ты и так написал:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("demo-server")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b

@mcp.resource("config://app")
def app_config() -> str:
    """Return the app's current JSON config."""
    return '{"env": "prod", "region": "us-east-1"}'

@mcp.prompt()
def code_review(language: str, code: str) -> str:
    """Review code for correctness and style."""
    return f"You are a senior {language} reviewer. Review:\n\n{code}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

Три декоратора — три примитива из [шагов 5](#step-5)–[7](#step-7). Аннотации типов уходят в JSON Schema, докстрока — в то описание, по которому модель решает, звать ли инструмент. Последняя строка поднимает сервер на stdio, и его уже можно прописать в Claude Desktop, указав путь к файлу.

Посчитай, сколько строк схемы ты тут написал. Ноль.

> 🎒 **На пальцах.** Как у портного. Ты не диктуешь ему обхват груди и длину рукава по памяти — приходишь в своей рубашке, и он снимает мерки прямо с неё. Твоя функция — эта рубашка: типы аргументов уже надеты на неё. `FastMCP` обмеряет её и выписывает мерочный лист, который увидит host. Ошибиться в цифрах невозможно: их никто не переписывал руками.
