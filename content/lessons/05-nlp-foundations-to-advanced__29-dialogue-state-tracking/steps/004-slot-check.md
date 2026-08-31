---
id: 004-slot-check
type: check
title: 'Что является slot, значением и полным состоянием?'
source_anchor: '## The Problem'
check:
  - question: >-
      Система хранит состояние {cuisine: italian, area: north, price: moderate}.
      Что является значением slot area?
    options:
      - area
      - north
      - 'Пара area: north'
      - Весь словарь
    correct: 1
    explanation: >-
      area — название slot, а north — его текущее значение. Пара area: north
      является частью состояния, а весь словарь — полным состоянием.
  - question: >-
      Ты просишь итальянский ресторан на севере со средней ценой. Какое
      состояние корректно представляет запрос?
    options:
      - '{italian: cuisine, north: area, moderate: price}'
      - '{cuisine: italian, area: north, price: moderate}'
      - '{cuisine: north, area: moderate, price: italian}'
    correct: 1
    explanation: >-
      Слева записываются названия slots: cuisine, area и price. Справа находятся
      их значения: italian, north и moderate. Все актуальные пары вместе
      образуют состояние.
---

Проверь, умеешь ли ты разделять три уровня в словаре из [шага 2](#step-2): название характеристики — это slot, конкретный выбор — его значение, а все актуальные пары вместе — состояние. Частая ошибка — принять пару `area: north` за slot целиком или перепутать левую и правую части.

> 🎒 **На пальцах.** Представь шкафчик с подписанными ячейками. Надпись «район» — это slot, карточка «север» внутри — значение. Одна ячейка показывает лишь часть запроса; содержимое всех ячеек одновременно даёт полное текущее состояние.
