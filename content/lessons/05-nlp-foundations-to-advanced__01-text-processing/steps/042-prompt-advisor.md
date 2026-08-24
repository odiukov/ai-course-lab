---
id: 042-prompt-advisor
type: theory
title: 'Ship It: промпт-советчик по предобработке'
source_anchor: '## Ship It'
---

Стратегию предобработки ты будешь выбирать не один раз, а на каждой новой задаче — и каждый раз всплывут те же четыре вопроса: чем резать, стеммить или лемматизировать, какие именно вызовы библиотеки, что сломается. Держать это в голове год спустя невозможно. Поэтому решения урока полезно один раз упаковать в промпт-советчик: описываешь задачу, получаешь готовую конфигурацию с обоснованием.

Промпт устроен как бланк из двух частей. Первая — что советчик обязан выдать: выбор токенизатора (регулярка, NLTK, spaCy или токенизатор трансформера) с обоснованием; стеммить, лемматизировать, и то и другое или ничего; конкретные имена функций, а для NLTK — ещё и проводку POS-тегов из шага 36; и один режим отказа, который надо проверить тестом.

Вторая часть важнее — три запрета. Не советовать stemming для текста, который увидит пользователь (`poni` вместо `pony` — из шага 23). Не советовать лемматизацию без POS-тегов: без них таблица получает заглушку NOUN и глаголы не сворачиваются. И помечать неанглийский вход как требующий другого конвейера — правила Портера писались под английские суффиксы.

Сохрани файл как `outputs/prompt-preprocessing-advisor.md`:

```markdown
---
name: preprocessing-advisor
description: Recommends a tokenization, stemming, and lemmatization setup for an NLP task.
phase: 5
lesson: 01
---

You advise on classical NLP preprocessing. Given a task description, you output:

1. Tokenization choice (regex, NLTK word_tokenize, spaCy, or transformer tokenizer). Explain why.
2. Whether to stem, lemmatize, both, or neither. Explain why.
3. Specific library calls. Name the functions. Quote the POS-tag translation if NLTK is involved.
4. One failure mode the user should test for.

Refuse to recommend stemming for user-visible text. Refuse to recommend lemmatization without POS tags. Flag non-English input as needing a different pipeline.
```

Запреты здесь — не украшение. Без них советчик радостно предложит красивое решение, которое ты уже видел ломающимся.

> 🎒 **На пальцах.** Врач на приёме не импровизирует: протокол велит выяснить четыре вещи и держит стоп-лист — «при этой аллергии данный препарат не назначать». Стоп-лист ценнее самих вопросов: он ловит именно то, о чём в спешке забывают. Промпт-советчик работает так же. Четыре пункта вывода — это анамнез, три отказа — стоп-лист, собранный из ошибок, на которые ты уже наступил в этом уроке.
