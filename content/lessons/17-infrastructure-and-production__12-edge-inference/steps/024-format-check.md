---
id: 024-format-check
type: check
title: >-
  Сопоставляем Core ML INT4, QNN INT4, MLC Q4, GGUF и NVFP4 с целевыми
  устройствами
source_anchor: '### Quantization choice per target'
check:
  - question: >-
      Разработчик пытается запустить на Qualcomm Hexagon модель, подготовленную
      для Core ML. В чём ошибка?
    options:
      - >-
        Core ML предназначен для Apple ANE, а для Hexagon нужен путь через QNN и
        конвертеры AI Hub
      - >-
        Core ML работает только в браузере, поэтому модель нужно перенести в
        WebLLM
      - 'Hexagon принимает только GGUF, поэтому достаточно переименовать файл'
      - 'Для Hexagon обязательно нужен Edge-LLM, используемый на мощных Jetson'
    correct: 0
    explanation: >-
      Одинаковая разрядность весов не делает артефакты взаимозаменяемыми: Apple
      ANE использует путь Core ML, а Qualcomm Hexagon — QNN и инструменты AI
      Hub.
  - question: >-
      Как правильно распределены пути запуска между Jetson Orin Nano и более
      мощными Jetson AGX или Thor?
    options:
      - Orin Nano — GGUF или TRT-LLM; AGX или Thor — Edge-LLM
      - Orin Nano — Core ML; AGX или Thor — QNN
      - Orin Nano — MLC с браузерным wasm; AGX или Thor — Core ML
      - Для всех этих Jetson требуется только WebLLM
    correct: 0
    explanation: >-
      Для Orin Nano предусмотрены Q4 GGUF и TRT-LLM INT4 с учётом ограничения
      памяти. AGX и Thor поддерживают путь Edge-LLM с NVFP4 и FP8 KV-кэшем.
---

Проверь, можешь ли ты после выбора из [шага 23](#step-23) назвать не просто разрядность, а весь путь запуска. INT4 здесь не универсальный файл: Apple ждёт Core ML, Qualcomm — QNN, а браузер — MLC Q4 вместе с `.wasm`. На Jetson Orin Nano подходят Q4 GGUF или TRT-LLM INT4, тогда как AGX и Thor могут идти по пути NVFP4 через Edge-LLM. Главная ловушка — переносить знакомый формат на чужой рантайм.
