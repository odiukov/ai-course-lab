"""Model System Dataset Cards

Правила: используйте только стандартную библиотеку Python;
файл test_exercise.py не изменять.
"""


def weak_sections(card, required_sections):
    """Верните обязательные разделы, которые отсутствуют или содержат только
    пустую строку, TBD, TODO, N/A либо «см. документацию».

    Сохраните порядок разделов из required_sections.
    """
    raise NotImplementedError


def accuracy_by_group(rows):
    """Рассчитайте точность отдельно для каждой группы.

    Каждый элемент rows имеет вид (группа, правильный_ответ, ответ_модели).
    Для пустого списка верните пустой словарь.
    """
    raise NotImplementedError


def ethics_documentation_percent(total_cards, documented_cards):
    """Верните процент карточек с заполненным разделом об этике.

    Для двух нулей верните 0.0. Отрицательные значения и число заполненных
    карточек больше общего числа должны приводить к ValueError.
    """
    raise NotImplementedError


def data_card_view(layers, level):
    """Соберите представление Data Card заданной глубины.

    Telescopic включает только свою секцию, periscopic добавляет средний
    слой, microscopic — все три. Неизвестный уровень должен вызвать
    ValueError. Исходный словарь изменять нельзя.
    """
    raise NotImplementedError


def verify_attestation(claim, signature, verifier_key):
    """Проверьте учебную HMAC-SHA256-аттестацию утверждения.

    Сериализуйте claim в канонический JSON с сортировкой ключей, без пробелов
    и с сохранением Unicode. Верните True только для корректной подписи.
    """
    raise NotImplementedError


def system_card_coverage(card):
    """Верните долю заполненных разделов System Card из пяти обязательных:
    safety_capabilities, prompt_injection_protection,
    data_exfiltration_detection, value_alignment и incident_response.

    Пустые значения и заглушки TBD, TODO, N/A, «см. документацию» не считаются.
    Дополнительные разделы не влияют на результат.
    """
    raise NotImplementedError
