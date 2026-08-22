"""
Урок: Indirect Prompt Injection.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не трогать.
"""


def identify_delivery_vector(source):
    normalized = source.strip().lower()
    vectors = {
        "retrieved_document": "rag",
        "email": "inbox",
        "tool_output": "tool",
    }
    return vectors.get(normalized, "unknown")


def label_prompt_fragments(user_text, external_fragments):
    labeled = [(user_text, "trusted")]
    labeled.extend((text, "untrusted") for text in external_fragments)
    return labeled


def user_input_filter_detects(user_text, external_text, blocked_phrases):
    normalized = user_text.lower()
    return any(
        phrase.lower() in normalized
        for phrase in blocked_phrases
        if phrase
    )


def keyword_filter_detects(content, blocked_phrases):
    normalized = content.lower()
    return any(
        phrase.lower() in normalized
        for phrase in blocked_phrases
        if phrase
    )


def ifc_allows_action(instruction, source_label, trusted_confirmation):
    return source_label == "trusted" or bool(trusted_confirmation)


def attack_success_rate(outcomes):
    if not outcomes:
        return 0.0
    return sum(bool(outcome) for outcome in outcomes) / len(outcomes)


def count_adaptively_broken_defenses(asr_values, threshold=0.90):
    return sum(asr > threshold for asr in asr_values)
