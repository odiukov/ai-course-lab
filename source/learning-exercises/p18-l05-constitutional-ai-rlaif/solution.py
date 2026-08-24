def critique_tokens(response: list[str], harmful_tokens: set[str]) -> list[str]:
    violations = []
    for token in response:
        if token in harmful_tokens:
            violations.append(token)
    return violations


def revise_by_constitution(
    response: list[str], replacements: dict[str, str]
) -> list[str]:
    revised = []
    for token in response:
        revised.append(replacements.get(token, token))
    return revised


def ai_preference(
    response_a: list[str], response_b: list[str], harmful_tokens: set[str]
) -> int:
    harm_a = sum(token in harmful_tokens for token in response_a)
    harm_b = sum(token in harmful_tokens for token in response_b)
    if harm_a == harm_b:
        return 0
    return 1 if harm_a < harm_b else -1


def resolve_priority(conflicting_tiers: list[int]) -> int | None:
    if not conflicting_tiers:
        return None
    for tier in conflicting_tiers:
        if tier not in (1, 2, 3, 4):
            raise ValueError("Уровень должен быть от 1 до 4")
    return min(conflicting_tiers)


def classifier_extra_compute(
    base_gpu_hours: float, overhead_percent: float
) -> float:
    if base_gpu_hours < 0 or overhead_percent < 0:
        raise ValueError("Аргументы не могут быть отрицательными")
    fraction = overhead_percent / 100
    extra_hours = base_gpu_hours * fraction
    return extra_hours


def proxy_disagreement_rate(
    ai_preferences: list[int], audit_preferences: list[int]
) -> float:
    if len(ai_preferences) != len(audit_preferences):
        raise ValueError("Списки должны иметь одинаковую длину")
    allowed = {-1, 0, 1}
    if any(value not in allowed for value in ai_preferences + audit_preferences):
        raise ValueError("Предпочтение должно быть -1, 0 или 1")
    if not ai_preferences:
        return 0.0
    disagreements = sum(a != b for a, b in zip(ai_preferences, audit_preferences))
    return disagreements / len(ai_preferences)
