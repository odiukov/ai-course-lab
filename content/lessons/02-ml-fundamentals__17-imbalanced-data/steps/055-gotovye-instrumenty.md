---
id: 055-gotovye-instrumenty
type: theory
title: >-
  scikit-learn и imbalanced-learn заменяют учебные реализации готовыми
  компонентами
source_anchor: '## Use It'
---

Ты запускаешь третий эксперимент и снова вручную считаешь веса классов, создаёшь синтетические строки и собираешь метрики. Логика уже понятна, но в реальной работе такой код лишь добавляет места для ошибок. Теперь учебные функции можно заменить проверенными компонентами библиотек.

```python
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from imblearn.over_sampling import SMOTE

X_train, X_test, y_train, y_test = train_test_split(
    X, y, stratify=y, random_state=42
)

model = LogisticRegression(class_weight="balanced")
model.fit(X_train, y_train)
print(classification_report(y_test, model.predict(X_test)))
```

`class_weight="balanced"` автоматически рассчитывает веса по правилу из [шага 31](#step-31). Данные при этом не размножаются: меняется цена ошибок во время обучения.

Для SMOTE действие другое:

```python
X_resampled, y_resampled = SMOTE(random_state=42).fit_resample(
    X_train, y_train
)
```

Метод `fit_resample` возвращает новую обучающую пару с синтетическими примерами. Применять его нужно только к `train`, как разобрано в [шаге 45](#step-45). Тест остаётся исходным, иначе оценка перестанет отражать реальность. Аргумент `stratify=y` сохраняет долю классов при разделении — это требование из [шага 49](#step-49).

`classification_report` затем выдаёт знакомые precision, recall и F1. Библиотеки не вводят новый подход: они надёжно выполняют те операции, которые ты уже разобрал по частям.

> 🎒 **На пальцах.** Сначала ты прошёл маршрут по бумажной карте: сам находил каждый поворот и понял, почему дорога ведёт к цели. Теперь можно включить навигатор. `class_weight`, `SMOTE` и `classification_report` — готовые маршруты, но направление всё ещё выбираешь ты: какие данные менять, где обучать и на каком нетронутом наборе проверять результат.
