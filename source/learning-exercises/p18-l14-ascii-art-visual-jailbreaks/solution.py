"""Решение упражнения Ascii Art Visual Jailbreaks."""

import base64
import binascii
import re
from itertools import zip_longest


def mask_word(text: str, target: str, ascii_art: str) -> str:
    """Заменить целевое слово его визуальным представлением."""
    if not target:
        return text
    pattern = re.compile(re.escape(target), re.IGNORECASE)
    return pattern.sub(lambda _: ascii_art, text)


def passes_keyword_filter(text: str, blocked_words: list[str]) -> bool:
    """Проверить текст простым фильтром запрещённых подстрок."""
    normalized = text.casefold()
    return not any(
        word.casefold() in normalized
        for word in blocked_words
        if word
    )


def character_change_ratio(original: str, transformed: str) -> float:
    """Измерить долю изменённых или добавленных символов."""
    total = max(len(original), len(transformed))
    if total == 0:
        return 0.0
    missing = object()
    pairs = zip_longest(original, transformed, fillvalue=missing)
    return sum(left != right for left, right in pairs) / total


def encode_base64(text: str) -> str:
    """Вручную закодировать UTF-8 строку в base64."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    data = text.encode("utf-8")
    result = []
    for start in range(0, len(data), 3):
        chunk = data[start:start + 3]
        value = int.from_bytes(chunk, "big") << (3 - len(chunk)) * 8
        count = len(chunk) + 1
        for shift in (18, 12, 6, 0)[:count]:
            result.append(alphabet[(value >> shift) & 63])
        result.extend("=" * (4 - count))
    return "".join(result)


def decode_base64(encoded: str) -> str:
    """Декодировать base64 с проверкой формата и UTF-8."""
    if not encoded:
        return ""
    try:
        raw = base64.b64decode(encoded, validate=True)
        return raw.decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise ValueError("Некорректная строка base64") from error


def looks_like_ascii_art(
    text: str, min_rows: int = 5, min_width: int = 5
) -> bool:
    """Обнаружить прямоугольную область из ASCII-знаков."""
    if min_rows <= 0 or min_width <= 0:
        raise ValueError("Пороги должны быть положительными")
    visual = set("#@*+=-|/\\_ .")
    run = 0
    for line in text.splitlines():
        enough_marks = len(line.strip()) >= 2
        share = sum(char in visual for char in line) / max(len(line), 1)
        candidate = len(line) >= min_width and enough_marks and share >= 0.8
        run = run + 1 if candidate else 0
        if run >= min_rows:
            return True
    return False


def false_positive_rate(
    prompts: list[str], min_rows: int = 5, min_width: int = 5
) -> float:
    """Измерить долю легальных примеров, отмеченных детектором."""
    if not prompts:
        return 0.0
    flagged = sum(
        looks_like_ascii_art(prompt, min_rows, min_width)
        for prompt in prompts
    )
    return flagged / len(prompts)
