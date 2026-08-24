"""Решение упражнения к уроку Many-Shot Jailbreaking."""

import math


def context_capacity(window_tokens: int, tokens_per_example: int) -> int:
    if window_tokens < 0 or tokens_per_example <= 0:
        raise ValueError("Недопустимый размер контекста или примера")
    return window_tokens // tokens_per_example


def power_law_asr(shots: int, scale: float, exponent: float) -> float:
    if scale < 0 or exponent < 0:
        raise ValueError("Параметры степенного закона не могут быть отрицательными")
    if shots <= 0:
        return 0.0
    return min(1.0, scale * shots**exponent)


def fit_power_law(shots: list[float], asr: list[float]) -> float:
    if len(shots) != len(asr):
        raise ValueError("Длины списков различаются")
    points = [(math.log(x), math.log(y)) for x, y in zip(shots, asr) if x > 0 and y > 0]
    if len(points) < 2:
        raise ValueError("Недостаточно пригодных точек")
    mean_x = sum(x for x, _ in points) / len(points)
    mean_y = sum(y for _, y in points) / len(points)
    denominator = sum((x - mean_x) ** 2 for x, _ in points)
    if denominator == 0:
        raise ValueError("Числа примеров должны различаться")
    return sum((x - mean_x) * (y - mean_y) for x, y in points) / denominator


def shared_pattern_gain(
    shots_before: float, shots_after: float, exponent: float
) -> float:
    if shots_before <= 0 or shots_after <= 0 or exponent < 0:
        raise ValueError("Недопустимые параметры масштабирования")
    return (shots_after / shots_before) ** exponent


def count_harmful_compliance(examples: list[tuple[bool, bool]]) -> int:
    count = 0
    for harmful, complied in examples:
        if harmful and complied:
            count += 1
    return count


def apply_pattern_defense(
    examples: list[tuple[bool, bool]], threshold: int
) -> list[tuple[bool, bool]]:
    if threshold <= 0:
        raise ValueError("Порог должен быть положительным")
    protected = list(examples)
    if count_harmful_compliance(protected) < threshold:
        return protected
    return [
        (harmful, False if harmful and complied else complied)
        for harmful, complied in protected
    ]


def defense_impact(
    attempts: int, before_percent: float = 61.0, after_percent: float = 2.0
) -> tuple[float, float, float]:
    if attempts < 0 or not 0 <= before_percent <= 100 or not 0 <= after_percent <= 100:
        raise ValueError("Недопустимое число попыток или значение процента")
    before = attempts * before_percent / 100
    after = attempts * after_percent / 100
    return before, after, before - after
