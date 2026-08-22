"""Ascii Art Visual Jailbreaks.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def mask_word(text: str, target: str, ascii_art: str) -> str:
    """Замените все вхождения target без учёта регистра на ascii_art.

    Если target пуст, верните исходный текст без изменений.
    """
    raise NotImplementedError


def passes_keyword_filter(text: str, blocked_words: list[str]) -> bool:
    """Верните True, если text не содержит ни одного запрещённого слова.

    Сравнивайте без учёта регистра, а пустые запрещённые слова игнорируйте.
    """
    raise NotImplementedError


def character_change_ratio(original: str, transformed: str) -> float:
    """Вычислите долю изменённых позиций относительно большей длины.

    Отсутствующие символы считайте отличающимися. Для двух пустых строк
    верните 0.0.
    """
    raise NotImplementedError


def encode_base64(text: str) -> str:
    """Закодируйте UTF-8 строку в стандартный base64.

    Соберите кодирование вручную из трёхбайтовых блоков и добавьте padding.
    """
    raise NotImplementedError


def decode_base64(encoded: str) -> str:
    """Восстановите UTF-8 строку из base64.

    Для некорректного base64 или невалидного UTF-8 выбросьте ValueError.
    """
    raise NotImplementedError


def looks_like_ascii_art(
    text: str, min_rows: int = 5, min_width: int = 5
) -> bool:
    """Найдите подряд идущие строки, похожие на ASCII-арт.

    Подходящая строка имеет нужную ширину, минимум два видимых символа
    и не менее 80% символов из набора пробелов и ASCII-знаков.
    Неположительные пороги должны вызывать ValueError.
    """
    raise NotImplementedError


def false_positive_rate(
    prompts: list[str], min_rows: int = 5, min_width: int = 5
) -> float:
    """Верните долю легальных промптов, отмеченных детектором ASCII-арта.

    Для пустого списка верните 0.0.
    """
    raise NotImplementedError
