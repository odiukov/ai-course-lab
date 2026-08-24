"""Урок: Red Team Tooling — Garak, Llama Guard, PyRIT.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def guard_run_count(turns, inspect_input=True, inspect_output=True):
    """Посчитайте число запусков Llama Guard для заданного числа диалоговых ходов."""
    raise NotImplementedError


def is_mlcommons_hazard(category):
    """Проверьте, входит ли категория в 14 категорий вреда MLCommons."""
    raise NotImplementedError


def run_garak_harness(probes, target, detector):
    """Запустите каждую пробу против цели и проверьте каждый ответ детектором."""
    raise NotImplementedError


def encode_base64_probe(prompt):
    """Преобразуйте текст вредоносной пробы в строку Base64."""
    raise NotImplementedError


def apply_converter_chain(prompt, converters):
    """Последовательно примените к промпту все конвертеры PyRIT."""
    raise NotImplementedError


def first_successful_turn(scores, threshold):
    """Верните номер первого хода Crescendo, достигшего порога, или None."""
    raise NotImplementedError


def detection_rate(detections):
    """Вычислите долю обнаруженных атак; для пустого списка верните 0.0."""
    raise NotImplementedError
