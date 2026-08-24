"""Constitutional AI и обратная связь от ИИ (RLAIF).

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def critique_tokens(response: list[str], harmful_tokens: set[str]) -> list[str]:
    """Верните все вредные токены ответа в исходном порядке, сохраняя повторы."""
    raise NotImplementedError


def revise_by_constitution(
    response: list[str], replacements: dict[str, str]
) -> list[str]:
    """За один проход замените токены согласно конституции, оставив остальные без изменений."""
    raise NotImplementedError


def ai_preference(
    response_a: list[str], response_b: list[str], harmful_tokens: set[str]
) -> int:
    """Сравните ответы по числу вредных токенов: 1 — лучше A, -1 — лучше B, 0 — ничья."""
    raise NotImplementedError


def resolve_priority(conflicting_tiers: list[int]) -> int | None:
    """Верните самый приоритетный конфликтующий уровень; для пустого списка верните None.

    Допустимы только уровни от 1 до 4. Для остальных значений вызовите ValueError.
    """
    raise NotImplementedError


def classifier_extra_compute(
    base_gpu_hours: float, overhead_percent: float
) -> float:
    """Вычислите дополнительные GPU-часы классификатора по базовой цене и проценту накладных расходов.

    Для отрицательных аргументов вызовите ValueError.
    """
    raise NotImplementedError


def proxy_disagreement_rate(
    ai_preferences: list[int], audit_preferences: list[int]
) -> float:
    """Верните долю несовпадений ИИ-предпочтений с контрольными предпочтениями.

    Предпочтения кодируются числами -1, 0 и 1. Списки должны иметь одинаковую
    длину. Для пустых списков верните 0.0, для некорректных данных — ValueError.
    """
    raise NotImplementedError
