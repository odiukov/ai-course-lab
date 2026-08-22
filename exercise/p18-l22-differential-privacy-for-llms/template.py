"""Дифференциальная приватность для LLM.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def dp_event_bound(event_probability, epsilon, delta):
    """Вычислите правую часть DP-неравенства: e^epsilon * p + delta.

    Вероятность и delta должны лежать от 0 до 1, а epsilon — быть
    неотрицательным. Для недопустимых значений поднимите ValueError.
    """
    raise NotImplementedError


def clip_gradient(gradient, clip_norm):
    """Обрежьте вектор градиента по евклидовой норме до clip_norm.

    Верните новый список. Вектор с нормой не больше порога не изменяйте.
    Отрицательный порог должен приводить к ValueError.
    """
    raise NotImplementedError


def add_dp_noise(gradient_sum, noise_multiplier, clip_norm, seed):
    """Добавьте к каждой координате суммы градиентов гауссов шум.

    Стандартное отклонение шума равно noise_multiplier * clip_norm.
    Используйте отдельный random.Random(seed). Отрицательные параметры
    шума или обрезки должны приводить к ValueError.
    """
    raise NotImplementedError


def approximate_epsilon(steps, sampling_rate, noise_multiplier, delta):
    """Оцените epsilon по учебной формуле.

    Используйте q * sqrt(2 * steps * log(1 / delta)) / sigma.
    steps должен быть неотрицательным, q — от 0 до 1, sigma — положительным,
    а delta — строго между 0 и 1. Иначе поднимите ValueError.
    """
    raise NotImplementedError


def is_canary_detected(canary_loss, baseline_loss, minimum_gap):
    """Определите канарейку по снижению log-loss.

    Верните True, если baseline_loss - canary_loss не меньше minimum_gap.
    Все три аргумента должны быть неотрицательными, иначе поднимите
    ValueError.
    """
    raise NotImplementedError


def quantize_confidence(confidence, decimals):
    """Округлите confidence, чтобы сократить канал утечки.

    confidence должен лежать от 0 до 1, а decimals должен быть
    неотрицательным целым числом. Иначе поднимите ValueError.
    """
    raise NotImplementedError
