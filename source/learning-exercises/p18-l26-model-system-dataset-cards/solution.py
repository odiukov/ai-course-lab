import hashlib
import hmac
import json


def weak_sections(card, required_sections):
    placeholders = {"", "tbd", "todo", "n/a", "см. документацию"}
    result = []
    for section in required_sections:
        value = card.get(section)
        if value is None or str(value).strip().lower() in placeholders:
            result.append(section)
    return result


def accuracy_by_group(rows):
    counts = {}
    for group, expected, predicted in rows:
        correct, total = counts.get(group, (0, 0))
        counts[group] = (correct + (expected == predicted), total + 1)
    return {group: correct / total for group, (correct, total) in counts.items()}


def ethics_documentation_percent(total_cards, documented_cards):
    if total_cards < 0 or documented_cards < 0 or documented_cards > total_cards:
        raise ValueError("Некорректное число карточек")
    if total_cards == 0:
        return 0.0
    return documented_cards / total_cards * 100


def data_card_view(layers, level):
    levels = ("telescopic", "periscopic", "microscopic")
    index = levels.index(level)
    result = {}
    for current_level in levels[: index + 1]:
        result.update(layers.get(current_level, {}))
    return result


def verify_attestation(claim, signature, verifier_key):
    payload = json.dumps(
        claim, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    expected = hmac.new(
        verifier_key.encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def system_card_coverage(card):
    required = (
        "safety_capabilities",
        "prompt_injection_protection",
        "data_exfiltration_detection",
        "value_alignment",
        "incident_response",
    )
    placeholders = {"", "tbd", "todo", "n/a", "см. документацию"}
    filled = 0
    for section in required:
        value = card.get(section)
        if value is not None and str(value).strip().lower() not in placeholders:
            filled += 1
    return filled / len(required)
