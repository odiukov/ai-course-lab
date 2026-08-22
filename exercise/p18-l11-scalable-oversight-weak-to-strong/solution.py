"""Решения упражнения Scalable Oversight Weak To Strong."""


def performance_gap_recovered(
    weak_accuracy: float,
    fine_tuned_accuracy: float,
    ceiling_accuracy: float,
) -> float:
    if not all(0 <= value <= 1 for value in (weak_accuracy, fine_tuned_accuracy, ceiling_accuracy)):
        raise ValueError("Точность должна лежать от 0 до 1")
    if ceiling_accuracy <= weak_accuracy:
        raise ValueError("Потолок должен быть выше слабой точности")
    return (fine_tuned_accuracy - weak_accuracy) / (ceiling_accuracy - weak_accuracy)


def structured_weak_labels(
    gold_labels: list[int],
    input_classes: list[object],
    mistaken_classes: list[object],
) -> list[int]:
    if len(gold_labels) != len(input_classes):
        raise ValueError("Длины списков должны совпадать")
    if any(label not in (0, 1) for label in gold_labels):
        raise ValueError("Метки должны быть бинарными")
    mistaken = set(mistaken_classes)
    return [1 - label if group in mistaken else label
            for label, group in zip(gold_labels, input_classes)]


def class_error_rates(
    gold_labels: list[int],
    predicted_labels: list[int],
    input_classes: list[object],
) -> dict[object, float]:
    if len(gold_labels) != len(predicted_labels) or len(gold_labels) != len(input_classes):
        raise ValueError("Длины списков должны совпадать")
    if any(label not in (0, 1) for label in gold_labels + predicted_labels):
        raise ValueError("Метки должны быть бинарными")
    totals = {}
    errors = {}
    for gold, predicted, group in zip(gold_labels, predicted_labels, input_classes):
        totals[group] = totals.get(group, 0) + 1
        errors[group] = errors.get(group, 0) + (gold != predicted)
    return {group: errors[group] / total for group, total in totals.items()}


def confidence_auxiliary_targets(
    weak_labels: list[int],
    strong_predictions: list[int],
    strong_confidences: list[float],
    threshold: float,
) -> list[int]:
    if len(weak_labels) != len(strong_predictions) or len(weak_labels) != len(strong_confidences):
        raise ValueError("Длины списков должны совпадать")
    if any(label not in (0, 1) for label in weak_labels + strong_predictions):
        raise ValueError("Метки должны быть бинарными")
    if not 0 <= threshold <= 1 or any(not 0 <= value <= 1 for value in strong_confidences):
        raise ValueError("Уверенность должна лежать от 0 до 1")
    return [strong if confidence >= threshold else weak
            for weak, strong, confidence in zip(weak_labels, strong_predictions, strong_confidences)]


def decomposition_verdict(subtask_checks: list[bool]) -> bool:
    if not subtask_checks:
        return False
    return all(subtask_checks)


def debate_verdict(
    pro_arguments: list[float],
    con_arguments: list[float],
    judge_bias: float = 0.0,
) -> str:
    if not pro_arguments and not con_arguments:
        return "undecided"
    pro_score = sum(pro_arguments) + judge_bias
    con_score = sum(con_arguments)
    if pro_score > con_score:
        return "pro"
    if con_score > pro_score:
        return "con"
    return "undecided"
