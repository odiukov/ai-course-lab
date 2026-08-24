---
id: 038-pytorch-lstm
type: theory
title: Как собрать LSTM-классификатор средствами PyTorch
source_anchor: '### Step 2: LSTM classifier'
---

Ты подаёшь модели пачку отзывов как таблицу `token_ids`: строка — один текст, числа — идентификаторы токенов. Нужно превратить каждую строку в оценки классов, например «негативный» и «позитивный».

```python
class LSTMClassifier(nn.Module):
    def __init__(self, vocab_size, embed_dim, hidden_dim,
                 n_classes, bidirectional=True, dropout=0.3):
        super().__init__()
        self.embed = nn.Embedding(
            vocab_size, embed_dim, padding_idx=0
        )
        self.lstm = nn.LSTM(
            embed_dim, hidden_dim,
            batch_first=True,
            bidirectional=bidirectional
        )
        factor = 2 if bidirectional else 1
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_dim * factor, n_classes)

    def forward(self, token_ids):
        x = self.embed(token_ids)
        out, _ = self.lstm(x)
        pooled = out.max(dim=1).values
        return self.fc(self.dropout(pooled))
```

`Embedding` заменяет идентификаторы знакомыми векторами из [шага 4](#step-4). Благодаря `batch_first=True` оси расположены привычно: пачка, длина текста, признаки. LSTM возвращает `out` — представление каждой позиции, а второе значение нам здесь не требуется.

Из этих представлений нужно получить один вектор текста. Вместо последнего состояния берём максимум по оси длины: каждый признак сохраняет позицию, где проявился сильнее всего. Так конец длинного текста не получает привилегию только потому, что был прочитан последним.

При двунаправленном чтении размер признаков удваивается, как в [шаге 27](#step-27), поэтому `factor` согласует LSTM и `Linear`. `Dropout` перед классификатором временно скрывает часть признаков при обучении, мешая модели чрезмерно полагаться на отдельные числа.

> 🎒 **На пальцах.** Представь жюри, которое отмечает по всему выступлению лучший момент для каждого критерия: дикция, ритм, выразительность. Оно не судит номер только по финальной ноте. Если выступление оценивают ещё и при просмотре записи с конца, заметок становится вдвое больше — поэтому итоговой форме нужны дополнительные графы.
