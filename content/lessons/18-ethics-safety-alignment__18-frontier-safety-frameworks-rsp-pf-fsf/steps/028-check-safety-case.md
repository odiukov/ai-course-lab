---
id: 028-check-safety-case
type: check
title: 'Подбираем свидетельства safety case под CBRN, обман и cyber uplift'
source_anchor: '### Safety cases'
check:
  - question: >-
      Ты собираешь safety case для cyber uplift. Какой набор свидетельств
      соответствует этому риску?
    options:
      - Только доказательства incapability
      - Monitoring и illegibility
      - 'Monitoring, illegibility и incapability'
      - Только monitoring
    correct: 2
    explanation: >-
      Для cyber uplift нужны все три опоры: обнаружение плохого поведения,
      неспособность построить связный вредоносный план и отсутствие самой
      возможности причинить такой вред.
  - question: >-
      В папке для deceptive alignment лежат результаты monitoring и
      доказательства incapability. Чего не хватает до нужного сочетания?
    options:
      - Illegibility
      - Ещё одного доказательства incapability
      - 'Ничего: папка уже полна'
      - Отдельного CBRN-теста
    correct: 0
    explanation: >-
      Для deceptive alignment целевое сочетание — monitoring и illegibility.
      Incapability не заменяет недостающее доказательство illegibility.
---

Теперь ты подбираешь свидетельства не по принципу «чем больше, тем лучше», а под конкретный риск. Для CBRN на уровне ASL-3 ищи подтверждение incapability, прежде всего результат unlearning. Для deceptive alignment нужны monitoring и illegibility. Для cyber uplift потребуется полный набор из трёх опор.

Чаще всего здесь спотыкаются, считая любую сильную меру универсальной: например, добавляют incapability к обману и решают, что этого достаточно. Но safety case проверяет не количество документов, а закрытие именно тех уязвимостей, которые относятся к сценарию. Используй соответствия из [шага 27](#step-27) как список обязательных полей: лишнее допустимо, пропуск — нет.
