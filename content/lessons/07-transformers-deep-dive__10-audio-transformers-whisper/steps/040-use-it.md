---
id: 040-use-it
type: theory
title: 'Запуск в проде: whisper и faster-whisper'
source_anchor: '## Use It'
---

Пять строк — и часовой митинг расшифрован:

```python
import whisper
model = whisper.load_model("large-v3-turbo")
result = model.transcribe("meeting.wav", language="en", task="transcribe")
print(result["text"])
print(result["segments"][0]["start"], result["segments"][0]["end"])
```

Узнаёшь аргументы? `language="en"` и `task="transcribe"` — это ровно те токены префикса, которые ты собирал руками в [шаге 17](#step-17), просто библиотека собирает их за тебя. А `segments[0]["start"]` — те самые таймстемпы с шагом 0.02 с из [шага 20](#step-20).

Запускаешь на длинном файле — и ждёшь. Долго. Модель ту же самую, `large-v3-turbo`, а времени уходит заметно больше, чем обещали. Что не так?

Ничего. Просто пакет `whisper` от OpenAI — референсная реализация: она написана, чтобы показать, как модель устроена, а не чтобы выжать скорость. Веса и архитектура — одно, код, который эти веса прогоняет, — совсем другое. Тот же turbo можно запустить движком, заточенным под инференс:

```python
from faster_whisper import WhisperModel
model = WhisperModel("large-v3-turbo", compute_type="int8_float16")
segments, info = model.transcribe("meeting.wav", vad_filter=True)
for s in segments:
    print(f"{s.start:.2f} - {s.end:.2f}: {s.text}")
```

Сравни блоки: имя модели то же, вызов `transcribe` тот же, на выходе те же сегменты с `start` и `end`. Различия — `compute_type` и `vad_filter`, про них следующие два экрана. И одна ловушка: `segments` тут — генератор, до цикла `for` не считается ничего. Увидел мгновенный ответ — это не скорость, это отложенная работа.

> 🎒 **На пальцах.** Как два принтера под одним драйвером. Ты жмёшь «печать», выбираешь тот же файл и тот же формат — команда не меняется. Но один внутри тянет лист медленно и греется, другой печатает вдвое быстрее и тратит меньше тонера. Документ на выходе тот же. Меняешь не то, что печатается, а механику, которая это делает.
