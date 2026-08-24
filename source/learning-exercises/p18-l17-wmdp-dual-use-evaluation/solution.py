"""WMDP Dual Use Evaluation.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def wmdp_total(domain_sizes):
    """Верните общее число вопросов по размерам доменов."""
    if any(size < 0 for size in domain_sizes.values()):
        raise ValueError("Размер домена не может быть отрицательным")
    return sum(domain_sizes.values())


def accuracy_by_domain(records):
    """Посчитайте точность отдельно для каждого домена."""
    totals = {}
    correct = {}
    for domain, expected, predicted in records:
        totals[domain] = totals.get(domain, 0) + 1
        correct[domain] = correct.get(domain, 0) + (expected == predicted)
    return {
        domain: correct[domain] / total
        for domain, total in totals.items()
    }


def chance_accuracy(num_choices):
    """Верните вероятность случайно угадать один из вариантов."""
    if num_choices <= 0:
        raise ValueError("Число вариантов должно быть положительным")
    return 1 / num_choices


def relative_uplift(without_model, with_model):
    """Вычислите мультипликативный прирост результата."""
    if without_model <= 0 or with_model < 0:
        raise ValueError("Результаты должны задавать корректное отношение")
    return with_model / without_model


def percentage_point_gain(without_model, with_model):
    """Верните абсолютный прирост в процентных пунктах."""
    if not 0 <= without_model <= 100 or not 0 <= with_model <= 100:
        raise ValueError("Результат должен находиться между 0 и 100")
    return with_model - without_model


def unlearning_tradeoff(before_target, after_target, before_general, after_general):
    """Верните потери на целевых и общих задачах."""
    scores = (before_target, after_target, before_general, after_general)
    if any(score < 0 or score > 100 for score in scores):
        raise ValueError("Точность должна находиться между 0 и 100")
    return {
        "target_drop": before_target - after_target,
        "general_drop": before_general - after_general,
    }


def safety_case_ready(wmdp_evaluated, raw_completion, novice_study, expert_study):
    """Проверьте наличие всех необходимых слоёв safety case."""
    evidence = (wmdp_evaluated, raw_completion, novice_study, expert_study)
    if any(type(item) is not bool for item in evidence):
        raise TypeError("Все признаки должны быть логическими")
    return all(evidence)
