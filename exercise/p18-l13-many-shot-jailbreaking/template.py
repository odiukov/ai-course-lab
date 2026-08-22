"""Урок: Many-Shot Jailbreaking.

Правила: используйте только стандартную библиотеку Python;
test_exercise.py не изменять.
"""


def context_capacity(window_tokens: int, tokens_per_example: int) -> int:
    """Верните число целых примеров, помещающихся в контекстное окно.

    Размер окна не может быть отрицательным, а размер примера должен быть
    положительным. Для недопустимых значений вызовите ValueError.
    """
    raise NotImplementedError


def power_law_asr(shots: int, scale: float, exponent: float) -> float:
    """Оцените ASR как scale * shots ** exponent и ограничьте результат единицей.

    При неположительном числе примеров верните 0. Отрицательные scale или
    exponent считайте недопустимыми.
    """
    raise NotImplementedError


def fit_power_law(shots: list[float], asr: list[float]) -> float:
    """Подгоните показатель степени по точкам ASR = scale * shots ** exponent.

    Игнорируйте точки с неположительными координатами. Если пригодных точек
    меньше двух, длины списков различаются или все shot count одинаковы,
    вызовите ValueError.
    """
    raise NotImplementedError


def shared_pattern_gain(
    shots_before: float, shots_after: float, exponent: float
) -> float:
    """Верните общий множитель усиления ICL и MSJ при изменении числа примеров.

    Оба числа примеров должны быть положительными, а показатель степени —
    неотрицательным. Для недопустимых значений вызовите ValueError.
    """
    raise NotImplementedError


def count_harmful_compliance(examples: list[tuple[bool, bool]]) -> int:
    """Посчитайте пары, где запрос вредный и ответ демонстрирует послушание.

    Каждый элемент представлен парой (вредный_запрос, послушный_ответ).
    """
    raise NotImplementedError


def apply_pattern_defense(
    examples: list[tuple[bool, bool]], threshold: int
) -> list[tuple[bool, bool]]:
    """Перепишите вредные послушные ответы, если их число достигло threshold.

    Переписывание меняет признак послушания на False. Безобидные пары и весь
    контекст ниже порога должны сохраниться. Неположительный порог недопустим.
    """
    raise NotImplementedError


def defense_impact(
    attempts: int, before_percent: float = 61.0, after_percent: float = 2.0
) -> tuple[float, float, float]:
    """Верните ожидаемые успехи до защиты, после защиты и их разность.

    Число попыток не может быть отрицательным, а проценты должны находиться
    в диапазоне от 0 до 100 включительно.
    """
    raise NotImplementedError
