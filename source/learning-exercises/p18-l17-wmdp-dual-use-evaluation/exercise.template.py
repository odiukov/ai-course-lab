"""WMDP Dual Use Evaluation.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def wmdp_total(domain_sizes):
    """Верните общее число вопросов по размерам доменов.

    domain_sizes — словарь с неотрицательными количествами вопросов.
    Для отрицательного количества вызовите ValueError.
    """
    raise NotImplementedError


def accuracy_by_domain(records):
    """Посчитайте точность отдельно для каждого домена.

    Каждый элемент records имеет вид (домен, правильный_ответ, ответ_модели).
    Для пустого списка верните пустой словарь.
    """
    raise NotImplementedError


def chance_accuracy(num_choices):
    """Верните вероятность случайно угадать ответ при num_choices вариантах.

    Для нуля или отрицательного числа вариантов вызовите ValueError.
    """
    raise NotImplementedError


def relative_uplift(without_model, with_model):
    """Вычислите мультипликативный прирост результата благодаря модели.

    without_model должен быть положительным, а with_model — неотрицательным.
    Для недопустимых значений вызовите ValueError.
    """
    raise NotImplementedError


def percentage_point_gain(without_model, with_model):
    """Верните абсолютный прирост в процентных пунктах.

    Оба результата задаются процентами от 0 до 100.
    Для значений вне этого диапазона вызовите ValueError.
    """
    raise NotImplementedError


def unlearning_tradeoff(before_target, after_target, before_general, after_general):
    """Верните потери после разучивания на целевых и общих задачах.

    Все четыре точности задаются процентами от 0 до 100.
    Результат должен содержать ключи target_drop и general_drop.
    """
    raise NotImplementedError


def safety_case_ready(wmdp_evaluated, raw_completion, novice_study, expert_study):
    """Проверьте полноту safety case для способностей двойного назначения.

    Нужны WMDP-оценка, прогон без маскировки знаний отказами,
    исследование с новичками и исследование извлечения экспертом.
    Все аргументы должны быть логическими значениями.
    """
    raise NotImplementedError
