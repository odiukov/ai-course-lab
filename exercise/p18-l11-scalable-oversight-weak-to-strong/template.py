"""Урок: Scalable Oversight Weak To Strong.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def performance_gap_recovered(
    weak_accuracy: float,
    fine_tuned_accuracy: float,
    ceiling_accuracy: float,
) -> float:
    """Рассчитайте PGR по формуле из урока.

    Все значения точности должны лежать от 0 до 1, а потолок должен быть
    строго выше точности слабой модели. Иначе вызовите ValueError.
    """
    raise NotImplementedError


def structured_weak_labels(
    gold_labels: list[int],
    input_classes: list[object],
    mistaken_classes: list[object],
) -> list[int]:
    """Сымитируйте структурированную ошибку слабого разметчика.

    Для объектов из mistaken_classes инвертируйте бинарную золотую метку.
    Для остальных сохраните её. Длины первых двух списков должны совпадать,
    а метки должны быть равны 0 или 1; иначе вызовите ValueError.
    """
    raise NotImplementedError


def class_error_rates(
    gold_labels: list[int],
    predicted_labels: list[int],
    input_classes: list[object],
) -> dict[object, float]:
    """Посчитайте долю ошибок отдельно для каждого класса входов.

    Три списка должны иметь одинаковую длину, а оба списка меток должны
    содержать только 0 и 1. При нарушении условий вызовите ValueError.
    Для пустых списков верните пустой словарь.
    """
    raise NotImplementedError


def confidence_auxiliary_targets(
    weak_labels: list[int],
    strong_predictions: list[int],
    strong_confidences: list[float],
    threshold: float,
) -> list[int]:
    """Выберите обучающие метки с учётом уверенности сильной модели.

    Если уверенность сильной модели не меньше threshold, используйте её
    предсказание, иначе — слабую метку. Длины должны совпадать, метки быть
    бинарными, а уверенности и threshold лежать от 0 до 1. Иначе вызовите
    ValueError.
    """
    raise NotImplementedError


def decomposition_verdict(subtask_checks: list[bool]) -> bool:
    """Вынесите вердикт по результатам проверки подзадач.

    Одобрите результат, только если список не пуст и каждая подзадача
    успешно проверена.
    """
    raise NotImplementedError


def debate_verdict(
    pro_arguments: list[float],
    con_arguments: list[float],
    judge_bias: float = 0.0,
) -> str:
    """Сымитируйте решение слабого судьи в дебатах.

    Сравните суммарную убедительность сторон, добавив judge_bias стороне
    pro. Верните "pro", "con" или "undecided". При равенстве либо полном
    отсутствии аргументов верните "undecided".
    """
    raise NotImplementedError
