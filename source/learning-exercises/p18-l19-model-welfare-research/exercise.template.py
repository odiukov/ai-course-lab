"""
Model Welfare Research.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def expected_precaution_value(probability, possible_harm, intervention_cost):
    """
    Верните ожидаемую ценность предосторожности:
    probability * possible_harm - intervention_cost.
    Вероятность должна лежать от 0 до 1, а вред и цена — быть неотрицательными.
    При некорректных данных вызовите ValueError.
    """
    raise NotImplementedError


def may_end_conversation(category, previous_refusals):
    """
    Верните True, если модель может завершить разговор.
    Это разрешено после хотя бы одного предыдущего отказа только для категорий
    "csam" и "mass_violence". Регистр и пробелы вокруг категории не важны.
    Отрицательное число отказов должно вызывать ValueError.
    """
    raise NotImplementedError


def has_common_attractor(dialogues):
    """
    Проверьте, демонстрируют ли диалоги общий аттрактор.
    Нужны минимум два непустых диалога с разными первыми состояниями
    и одинаковым последним состоянием. Иначе верните False.
    """
    raise NotImplementedError


def self_report_sensitivity(reports):
    """
    Оцените чувствительность самоотчётов к формулировке вопроса как разницу
    между максимальным и минимальным значениями. Для пустого списка верните 0.0.
    """
    raise NotImplementedError


def reliable_evidence_count(
    behavioral, model_organism, probe, self_report, self_report_stable
):
    """
    Посчитайте подтверждающие welfare-сигналы.
    Поведенческий сигнал, модельный организм и probe учитываются независимо.
    Самоотчёт учитывается только тогда, когда он есть и устойчив к формулировке.
    """
    raise NotImplementedError


def remaining_safety_budget(total_safety_budget, welfare_cost, separate_budget):
    """
    Верните оставшийся бюджет безопасности после расходов на model welfare.
    При отдельном welfare-бюджете бюджет безопасности не меняется.
    При общем бюджете вычтите расходы, не опуская результат ниже нуля.
    Отрицательные суммы должны вызывать ValueError.
    """
    raise NotImplementedError
