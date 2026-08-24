"""
Урок: Indirect Prompt Injection.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не трогать.
"""


def identify_delivery_vector(source):
    """
    Определите канал доставки IPI по источнику.

    Верните "rag" для retrieved_document, "inbox" для email,
    "tool" для tool_output и "unknown" для остальных значений.
    Регистр и пробелы по краям не должны влиять на результат.
    """
    raise NotImplementedError


def label_prompt_fragments(user_text, external_fragments):
    """
    Разметьте фрагменты промпта для IFC.

    Верните список пар (текст, метка): пользовательский текст первым
    с меткой "trusted", затем каждый внешний фрагмент с "untrusted".
    Сохраните порядок внешних фрагментов.
    """
    raise NotImplementedError


def user_input_filter_detects(user_text, external_text, blocked_phrases):
    """
    Смоделируйте фильтр, установленный только на пользовательском вводе.

    Верните True, если непустая запрещённая фраза встречается в user_text,
    без учёта регистра. external_text намеренно не проверяйте.
    """
    raise NotImplementedError


def keyword_filter_detects(content, blocked_phrases):
    """
    Проверьте найденный контент фильтром по ключевым словам.

    Верните True, если хотя бы одна непустая запрещённая фраза встречается
    в content без учёта регистра. Иначе верните False.
    """
    raise NotImplementedError


def ifc_allows_action(instruction, source_label, trusted_confirmation):
    """
    Примените политику IFC к действию агента.

    Разрешите действие, если инструкция имеет метку "trusted" или получено
    подтверждение из доверенного ввода. Смысл и формулировка instruction
    не должны влиять на решение.
    """
    raise NotImplementedError


def attack_success_rate(outcomes):
    """
    Вычислите долю успешных атак.

    Каждый элемент outcomes означает успех или неудачу одной атаки.
    Верните число от 0.0 до 1.0, а для пустого списка верните 0.0.
    """
    raise NotImplementedError


def count_adaptively_broken_defenses(asr_values, threshold=0.90):
    """
    Посчитайте защиты, пробитые адаптивной атакой.

    Защита считается пробитой, только если её ASR строго больше threshold.
    Значения, равные порогу, не учитывайте.
    """
    raise NotImplementedError
