---
id: 041-use-it
type: theory
title: generate() в transformers и что под капотом
source_anchor: '## Use It'
---

Ты своими руками написал softmax, causal-маску, top-k, top-p, min-p. А в реальном коде всё это выглядит так:

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.2-3B-Instruct")
tok = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-3B-Instruct")

inputs = tok("Attention is all you need because", return_tensors="pt")
out = model.generate(**inputs, max_new_tokens=64, temperature=0.7, top_p=0.9, do_sample=True)
print(tok.decode(out[0]))
```

Одна строка вместо всего урока. Обидно и подозрительно: куда делось то, что ты писал?

Никуда. Внутри `generate()` крутится ровно тот цикл, который ты разобрал в [шаге 21](#step-21): прогнать модель вперёд, взять логиты последней позиции, отфильтровать и сэмплировать один токен, дописать его к последовательности, повторить. Посмотри на аргументы — это подписи к твоим же функциям. `temperature=0.7` — деление логитов на $T$ из [шага 28](#step-28). `top_p=0.9` — отсечка по накопленной вероятности из [шага 31](#step-31). `do_sample=True` — «не жадный выбор». А `max_new_tokens=64` — это буквально 64 оборота цикла, 64 forward pass, как ты считал в [шаге 22](#step-22).

Продакшн-движки — vLLM, TensorRT-LLM, llama.cpp, Ollama, MLX — реализуют этот же цикл. Разница не в логике, а в том, сколько выжато из железа: батчевый prefill, continuous batching, пагинация KV cache, speculative decoding из [шага 36](#step-36).

Так что `generate()` — не чёрный ящик с другой физикой внутри, а твой цикл, свёрнутый в одну строку.

> 🎒 **На пальцах.** Кофемашина: нажал кнопку — через двадцать секунд чашка. Внутри жернова мелют зерно, поршень трамбует таблетку, помпа гонит воду под девятью барами. Ты этого не видишь, но именно поэтому ручки «крепость» и «объём» тебе понятны — они управляют этими самыми шагами. `generate()` устроен так же: кнопка снаружи, знакомый механизм внутри, аргументы — ручки на нём.
