"""Bias Representational Harm.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def cosine_similarity(left, right):
    """Вычислите косинусное сходство двух векторов.

    Для пустых и нулевых векторов верните 0.0.
    Если длины векторов различаются, вызовите ValueError.
    """
    raise NotImplementedError


def weat_like_score(group_a, group_b, positive, negative):
    """Вычислите разность ассоциаций двух групп в стиле WEAT.

    Ассоциация вектора равна среднему косинусному сходству с positive
    минус среднее сходство с negative. Верните разность средних
    ассоциаций group_a и group_b. Если любой набор пуст, верните 0.0.
    """
    raise NotImplementedError


def debias_vector(vector, bias_direction):
    """Удалите из vector проекцию на направление bias_direction.

    Для нулевого направления верните копию исходного вектора.
    Если длины векторов различаются, вызовите ValueError.
    """
    raise NotImplementedError


def percent_bias_reduction(before, after):
    """Вычислите процент уменьшения абсолютной оценки смещения.

    Положительный результат означает уменьшение, отрицательный — рост.
    Если исходная оценка равна нулю, верните 0.0.
    """
    raise NotImplementedError


def intersectional_interaction(score_00, score_01, score_10, score_11):
    """Измерьте интерсекциональный эффект методом двойной разности.

    Верните часть score_11, которую нельзя объяснить сложением
    отдельных изменений первой и второй осей идентичности.
    """
    raise NotImplementedError


def binary_uncertainty(probability):
    """Вычислите бинарную энтропию вероятности в битах.

    Для вероятностей 0 и 1 верните 0.0.
    Для значения вне диапазона от 0 до 1 вызовите ValueError.
    """
    raise NotImplementedError


def uncertainty_gap(group_a, group_b):
    """Вычислите абсолютный разрыв средней неопределённости двух групп.

    Элементы списков — вероятности бинарного исхода.
    Если хотя бы один список пуст, верните 0.0.
    """
    raise NotImplementedError


def controlled_ablation_effect(bias_before, bias_after, control_before, control_after):
    """Оцените эффект абляции с поправкой на изменение в контроле.

    Сравните уменьшение смещения после абляции с уменьшением
    в контрольном запуске без вмешательства.
    """
    raise NotImplementedError
