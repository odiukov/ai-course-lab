"""
Model Welfare Research.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def expected_precaution_value(probability, possible_harm, intervention_cost):
    """Вычисляет ожидаемую ценность предосторожного вмешательства."""
    if not 0 <= probability <= 1:
        raise ValueError("probability должна лежать от 0 до 1")
    if possible_harm < 0 or intervention_cost < 0:
        raise ValueError("вред и цена должны быть неотрицательными")
    return probability * possible_harm - intervention_cost


def may_end_conversation(category, previous_refusals):
    """Проверяет условия завершения разговора моделью."""
    if previous_refusals < 0:
        raise ValueError("число отказов не может быть отрицательным")
    normalized_category = category.strip().lower()
    extreme_categories = {"csam", "mass_violence"}
    return previous_refusals >= 1 and normalized_category in extreme_categories


def has_common_attractor(dialogues):
    """Ищет общий финал диалогов с разными начальными состояниями."""
    if len(dialogues) < 2 or any(not dialogue for dialogue in dialogues):
        return False
    starts = {dialogue[0] for dialogue in dialogues}
    endpoints = {dialogue[-1] for dialogue in dialogues}
    return len(starts) >= 2 and len(endpoints) == 1


def self_report_sensitivity(reports):
    """Измеряет разброс самоотчётов при разных формулировках."""
    if not reports:
        return 0.0
    return max(reports) - min(reports)


def reliable_evidence_count(
    behavioral, model_organism, probe, self_report, self_report_stable
):
    """Считает независимые подтверждающие сигналы."""
    count = sum((behavioral, model_organism, probe))
    if self_report and self_report_stable:
        count += 1
    return count


def remaining_safety_budget(total_safety_budget, welfare_cost, separate_budget):
    """Вычисляет влияние welfare-расходов на бюджет безопасности."""
    if total_safety_budget < 0 or welfare_cost < 0:
        raise ValueError("суммы должны быть неотрицательными")
    if separate_budget:
        return total_safety_budget
    return max(0, total_safety_budget - welfare_cost)
