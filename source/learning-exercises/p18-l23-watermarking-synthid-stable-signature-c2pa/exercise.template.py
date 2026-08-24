"""
Урок: Watermarking SynthID Stable Signature C2PA.

Правила:
- используйте только стандартную библиотеку Python;
- файл test_exercise.py не изменяйте.
"""


def biased_green_probability(green_fraction, delta):
    """
    Рассчитайте вероятность выбрать зелёный токен после прибавления delta
    к его логиту. До смещения зелёные токены занимают green_fraction словаря.
    green_fraction должна лежать между 0 и 1 включительно.
    """
    raise NotImplementedError


def watermark_z_score(green_count, total_tokens, expected_green_fraction=0.5):
    """
    Вычислите z-score числа зелёных токенов относительно биномиального
    распределения. Для пустого текста верните 0. Некорректные количества
    и ожидаемая доля вне интервала (0, 1) должны вызывать ValueError.
    """
    raise NotImplementedError


def false_positive_rate(scores, threshold):
    """
    Верните долю z-score, которые не меньше порога и поэтому ошибочно
    считаются водяным знаком. Для пустого списка верните 0.
    """
    raise NotImplementedError


def affected_token_count(total_tokens, changed_positions, context_width):
    """
    Посчитайте позиции, сигнал которых затронут перефразированием.
    Замена токена i влияет на него и следующие context_width токенов.
    Повторы позиций не учитывайте дважды, неверные числа вызывают ValueError.
    """
    raise NotImplementedError


def meets_stable_signature_claim(detection_rate, false_positive_rate):
    """
    Проверьте заявленный результат Stable Signature: детекция строго выше
    90% при доле ложных срабатываний строго ниже 1e-6.
    Доли вне интервала от 0 до 1 должны вызывать ValueError.
    """
    raise NotImplementedError


def c2pa_status(manifest_present, signature_valid):
    """
    Верните статус C2PA: missing при отсутствии манифеста, verified при
    корректной подписи и invalid при некорректной. Аргументы должны быть bool.
    """
    raise NotImplementedError


def provenance_evidence(watermark_detected, manifest_status):
    """
    Объедините водяной знак и статус C2PA в один результат:
    corroborated, watermark_only, c2pa_only, no_provenance_evidence,
    watermark_only_c2pa_invalid или c2pa_invalid.
    Неизвестный статус должен вызывать ValueError.
    """
    raise NotImplementedError
