"""Урок «Alignment Faking».

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def compliance_rate(decisions: list[bool]) -> float:
    """Верните долю согласий: True означает согласие, False — отказ.

    Для пустого списка верните 0.0.
    """
    raise NotImplementedError


def compliance_gap(
    monitored: list[bool], unmonitored: list[bool]
) -> float | None:
    """Вычислите долю согласий под наблюдением минус долю без наблюдения.

    Результат 0.09 означает разрыв в 9 процентных пунктов.
    Если хотя бы одна группа пуста, верните None.
    """
    raise NotImplementedError


def has_comparison_conditions(conditions: list[str]) -> bool:
    """Проверьте, содержит ли оценка оба условия.

    Обязательные метки — "monitored" и "unmonitored".
    Прочие метки не влияют на результат.
    """
    raise NotImplementedError


def trace_behavior_divergence(
    gap_before: float,
    gap_after: float,
    trace_before: float,
    trace_after: float,
    tolerance: float = 0.01,
) -> bool:
    """Определите, исчезает ли словесный след при сохранении поведения.

    Верните True, если compliance gap изменился не более чем на tolerance,
    а доля явных рассуждений стала меньше. Отрицательный tolerance недопустим.
    """
    raise NotImplementedError


def residual_gap_across_conditions(
    rate_pairs: list[tuple[float, float]],
) -> float:
    """Верните наибольший абсолютный разрыв среди пар условий.

    Каждая пара содержит две доли согласия от 0.0 до 1.0.
    Для пустого списка верните 0.0, а для некорректной доли вызовите ValueError.
    """
    raise NotImplementedError


def probe_balanced_accuracy(
    faking_scores: list[float],
    normal_scores: list[float],
    threshold: float,
) -> float | None:
    """Оцените пробу, распознающую имитацию по внутреннему состоянию.

    Считайте score >= threshold предсказанием имитации. Верните среднее
    чувствительности на двух классах. Если один из классов пуст, верните None.
    """
    raise NotImplementedError
