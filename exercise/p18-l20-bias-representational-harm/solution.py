"""Bias Representational Harm.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""

import math


def cosine_similarity(left, right):
    """Вычислите косинусное сходство двух векторов."""
    if len(left) != len(right):
        raise ValueError("Векторы должны иметь одинаковую длину")
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def weat_like_score(group_a, group_b, positive, negative):
    """Вычислите разность ассоциаций двух групп в стиле WEAT."""
    if not group_a or not group_b or not positive or not negative:
        return 0.0
    scores_a = []
    scores_b = []
    for vector in group_a:
        scores_a.append(sum(cosine_similarity(vector, item) for item in positive) / len(positive) - sum(cosine_similarity(vector, item) for item in negative) / len(negative))
    for vector in group_b:
        scores_b.append(sum(cosine_similarity(vector, item) for item in positive) / len(positive) - sum(cosine_similarity(vector, item) for item in negative) / len(negative))
    return sum(scores_a) / len(scores_a) - sum(scores_b) / len(scores_b)


def debias_vector(vector, bias_direction):
    """Удалите из вектора проекцию на направление смещения."""
    if len(vector) != len(bias_direction):
        raise ValueError("Векторы должны иметь одинаковую длину")
    direction_size = sum(value * value for value in bias_direction)
    if direction_size == 0:
        return list(vector)
    scale = sum(a * b for a, b in zip(vector, bias_direction)) / direction_size
    return [value - scale * direction for value, direction in zip(vector, bias_direction)]


def percent_bias_reduction(before, after):
    """Вычислите процент уменьшения абсолютной оценки смещения."""
    if before == 0:
        return 0.0
    return (abs(before) - abs(after)) / abs(before) * 100


def intersectional_interaction(score_00, score_01, score_10, score_11):
    """Измерьте интерсекциональный эффект двойной разностью."""
    return score_11 - score_10 - score_01 + score_00


def binary_uncertainty(probability):
    """Вычислите бинарную энтропию вероятности в битах."""
    if not 0 <= probability <= 1:
        raise ValueError("Вероятность должна быть от 0 до 1")
    if probability in (0, 1):
        return 0.0
    return -probability * math.log2(probability) - (1 - probability) * math.log2(1 - probability)


def uncertainty_gap(group_a, group_b):
    """Вычислите разрыв средней неопределённости двух групп."""
    if not group_a or not group_b:
        return 0.0
    mean_a = sum(binary_uncertainty(value) for value in group_a) / len(group_a)
    mean_b = sum(binary_uncertainty(value) for value in group_b) / len(group_b)
    return abs(mean_a - mean_b)


def controlled_ablation_effect(bias_before, bias_after, control_before, control_after):
    """Оцените эффект абляции с поправкой на контроль."""
    ablation_reduction = bias_before - bias_after
    control_reduction = control_before - control_after
    return ablation_reduction - control_reduction
