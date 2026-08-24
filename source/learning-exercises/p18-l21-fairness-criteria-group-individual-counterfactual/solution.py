"""Решения упражнения о критериях справедливости."""

import math


def demographic_parity_gap(group_a_predictions, group_b_predictions):
    rate_a = sum(value == 1 for value in group_a_predictions) / len(group_a_predictions) if group_a_predictions else 0.0
    rate_b = sum(value == 1 for value in group_b_predictions) / len(group_b_predictions) if group_b_predictions else 0.0
    return abs(rate_a - rate_b)


def equalized_odds_gap(y_true, y_pred, groups):
    if len(y_true) != len(y_pred) or len(y_true) != len(groups):
        raise ValueError("Списки должны иметь одинаковую длину")
    rates = {}
    for group in (0, 1):
        for truth in (0, 1):
            indices = [i for i, value in enumerate(y_true) if groups[i] == group and value == truth]
            rates[group, truth] = sum(y_pred[i] == 1 for i in indices) / len(indices) if indices else 0.0
    return max(abs(rates[0, 1] - rates[1, 1]), abs(rates[0, 0] - rates[1, 0]))


def conditional_use_accuracy_gap(y_true, y_pred, groups):
    if len(y_true) != len(y_pred) or len(y_true) != len(groups):
        raise ValueError("Списки должны иметь одинаковую длину")
    rates = {}
    for group in (0, 1):
        for prediction in (0, 1):
            indices = [i for i, value in enumerate(y_pred) if groups[i] == group and value == prediction]
            correct = sum(y_true[i] == prediction for i in indices)
            rates[group, prediction] = correct / len(indices) if indices else 0.0
    return max(abs(rates[0, 1] - rates[1, 1]), abs(rates[0, 0] - rates[1, 0]))


def lipschitz_violations(features, scores, L=1.0):
    if L < 0:
        raise ValueError("L не может быть отрицательной")
    if len(features) != len(scores):
        raise ValueError("Число объектов и оценок должно совпадать")
    violations = 0
    for i in range(len(features)):
        for j in range(i + 1, len(features)):
            if abs(scores[i] - scores[j]) > L * math.dist(features[i], features[j]):
                violations += 1
    return violations


def is_counterfactually_fair(observed_scores, counterfactual_scores, tolerance=0.0):
    if len(observed_scores) != len(counterfactual_scores):
        raise ValueError("Списки оценок должны иметь одинаковую длину")
    if tolerance < 0:
        raise ValueError("Допуск не может быть отрицательным")
    return all(abs(a - b) <= tolerance for a, b in zip(observed_scores, counterfactual_scores))


def backtracking_plan(current_features, target_features, protected_indices):
    if len(current_features) != len(target_features):
        raise ValueError("Наборы признаков должны иметь одинаковую длину")
    protected = set(protected_indices)
    return [(i, target) for i, (current, target) in enumerate(zip(current_features, target_features)) if i not in protected and current != target]
