"""Критерии справедливости — group, individual, counterfactual.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py изменять нельзя.
"""


def demographic_parity_gap(group_a_predictions, group_b_predictions):
    """Верните модуль разницы долей решений 1 в двух группах.

    Для пустой группы считайте долю положительных решений равной нулю.
    """
    raise NotImplementedError


def equalized_odds_gap(y_true, y_pred, groups):
    """Верните наибольший разрыв TPR или FPR между группами 0 и 1.

    Все три списка должны иметь одинаковую длину. Если для доли нет
    подходящих наблюдений, считайте её равной нулю.
    """
    raise NotImplementedError


def conditional_use_accuracy_gap(y_true, y_pred, groups):
    """Верните наибольший разрыв PPV или NPV между группами 0 и 1.

    PPV — доля истинных единиц среди предсказанных единиц, NPV — доля
    истинных нулей среди предсказанных нулей. Пустую долю считайте нулём.
    """
    raise NotImplementedError


def lipschitz_violations(features, scores, L=1.0):
    """Посчитайте пары, нарушающие individual fairness.

    Признаки уже нормализованы. Для каждой неупорядоченной пары проверьте
    |score_i - score_j| <= L * L2(features_i, features_j).
    Отрицательное L недопустимо.
    """
    raise NotImplementedError


def is_counterfactually_fair(observed_scores, counterfactual_scores, tolerance=0.0):
    """Проверьте counterfactual fairness для результатов одного причинного DAG.

    Решение справедливо, если оценка каждого человека после контрфактической
    замены защищённого атрибута отличается не больше чем на tolerance.
    """
    raise NotImplementedError


def backtracking_plan(current_features, target_features, protected_indices):
    """Верните план изменений только для незащищённых признаков.

    Результат — список пар (индекс, целевое значение) для отличающихся
    признаков. Индексы из protected_indices в план включать нельзя.
    """
    raise NotImplementedError
