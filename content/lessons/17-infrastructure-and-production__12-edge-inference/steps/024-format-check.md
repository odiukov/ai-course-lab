---
id: 024-format-check
type: check
title: >-
  Сопоставляем Core ML INT4, QNN INT4, MLC Q4, GGUF и NVFP4 с целевыми
  устройствами
source_anchor: '### Quantization choice per target'
check:
  - question: >-
      Ты скачал GGUF-модель и хочешь запустить её через WebLLM в браузере. Что
      придётся сделать?
    options:
      - 'Передать GGUF прямо в WebLLM: браузер сам выберет ядра WebGPU'
      - Конвертировать веса в MLC Q4 q4f16_1 и подготовить скомпилированный wasm
      - Конвертировать модель в Core ML INT4
      - Перевести веса в NVFP4 и запускать через Edge-LLM
    correct: 1
    explanation: >-
      WebLLM не поддерживает GGUF. Для браузерного пути нужны формат MLC Q4 и
      совместимый с ним скомпилированный wasm.
  - question: Какое сопоставление формата и целевого устройства составлено верно?
    options:
      - >-
        Apple ANE — QNN INT4; Qualcomm Hexagon — Core ML INT4; Jetson Thor —
        GGUF
      - Apple ANE — GGUF; WebGPU — NVFP4; Jetson Orin Nano — MLC Q4
      - >-
        Apple ANE — Core ML INT4; Qualcomm Hexagon — QNN INT4; Jetson AGX или
        Thor — NVFP4
      - >-
        WebGPU — GGUF; Jetson Orin Nano — Core ML INT4; Qualcomm Hexagon — MLC
        Q4
    correct: 2
    explanation: >-
      Формат должен совпадать с путём исполнения: Core ML для Apple, QNN для
      Qualcomm, а NVFP4 через Edge-LLM — для мощных Jetson.
---

Проверь, можешь ли ты после выбора из [шага 23](#step-23) назвать не просто разрядность, а весь путь запуска. INT4 здесь не универсальный файл: Apple ждёт Core ML, Qualcomm — QNN, а браузер — MLC Q4 вместе с `.wasm`. На Jetson Orin Nano подходят Q4 GGUF или TRT-LLM INT4, тогда как AGX и Thor могут идти по пути NVFP4 через Edge-LLM. Главная ловушка — переносить знакомый формат на чужой рантайм.

> 🎒 **На пальцах.** Представь пять посылок для разных пунктов выдачи. На каждой мало написать «лёгкая, 4 кг»: нужны правильная упаковка и накладная конкретной службы. GGUF доедет до Jetson, но браузерный пункт его не примет; ему нужна посылка MLC с отдельным пропуском `.wasm`. Формат — это не только размер груза, но и совместимый маршрут доставки.
