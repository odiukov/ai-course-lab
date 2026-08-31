---
id: 036-proverka-pipeline
type: check
title: 'Проверка: три критичных настройки TfidfVectorizer для тональности'
source_anchor: '## Use It'
check:
  - question: >-
      Ты настраиваешь TF-IDF для отзывов. Какой набор сохраняет отрицания,
      добавляет признаки для соседних пар слов и ослабляет влияние многократных
      повторов?
    options:
      - 'stop_words=None, ngram_range=(1, 2), sublinear_tf=True'
      - 'stop_words=''english'', ngram_range=(1, 1), sublinear_tf=False'
      - 'stop_words=''english'', ngram_range=(1, 2), sublinear_tf=True'
      - 'stop_words=None, ngram_range=(1, 1), sublinear_tf=False'
    correct: 0
    explanation: >-
      stop_words=None сохраняет отрицания, диапазон (1, 2) включает униграммы и
      биграммы, а sublinear_tf=True логарифмически сжимает term frequency.
  - question: >-
      В отзыве есть фраза not good, а слово awful повторено десять раз. Что
      сделает TfidfVectorizer с ngram_range=(1, 2) и sublinear_tf=True?
    options:
      - Удалит отдельные слова и оставит только признак not good
      - Добавит признак not good и уменьшит рост веса awful из-за повторов
      - Удалит все повторные вхождения awful
      - Заменит всю фразу одним признаком good awful
    correct: 1
    explanation: >-
      Диапазон (1, 2) сохраняет отдельные слова и добавляет биграмму not good.
      Сублинейный TF не удаляет повторы, а заменяет линейный счётчик на 1 +
      log(tf), поэтому их влияние растёт медленнее.
---

Теперь ты должен уметь проверить конфигурацию не по названию параметров, а по её последствиям для отзыва. `stop_words=None` не даёт потерять отрицание — эту ловушку мы разобрали в [шаге 34](#step-34). `ngram_range=(1, 2)` оставляет отдельные слова и добавляет пары вроде `not good`, а `sublinear_tf=True` ослабляет чрезмерный голос повторов, как в [шаге 35](#step-35).

Чаще всего спотыкаются на двух вещах: считают, что биграммы заменяют униграммы, или думают, что sublinear TF удаляет повторы. Нет: первый параметр расширяет набор признаков, второй лишь сжимает их вес.
