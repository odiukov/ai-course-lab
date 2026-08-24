"""Решение упражнения Moderation Systems OpenAI Perspective LlamaGuard."""


def collapse_openai_category(category: str) -> str:
    valid = {
        "harassment", "harassment/threatening", "hate", "hate/threatening",
        "illicit", "illicit/violent", "self-harm", "self-harm/intent",
        "self-harm/instructions", "sexual", "sexual/minors", "violence",
        "violence/graphic",
    }
    if category not in valid:
        raise ValueError("Неизвестная категория OpenAI")
    return category.split("/", 1)[0]


def supports_image_moderation(category: str) -> bool:
    valid = {
        "harassment", "harassment/threatening", "hate", "hate/threatening",
        "illicit", "illicit/violent", "self-harm", "self-harm/intent",
        "self-harm/instructions", "sexual", "sexual/minors", "violence",
        "violence/graphic",
    }
    if category not in valid:
        raise ValueError("Неизвестная категория OpenAI")
    return category in {"violence", "self-harm", "sexual"}


def perspective_action(score: float, threshold: float) -> str:
    if not 0 <= score <= 1:
        raise ValueError("Оценка должна находиться от 0 до 1")
    if not 0 <= threshold <= 1:
        raise ValueError("Порог должен находиться от 0 до 1")
    return "hide" if score >= threshold else "show"


def parallel_layer_latency(latencies_ms: list[float]) -> float:
    if any(latency < 0 for latency in latencies_ms):
        raise ValueError("Задержка не может быть отрицательной")
    if not latencies_ms:
        return 0
    return max(latencies_ms)


def first_triggered_layer(
    input_flagged: bool,
    custom_flagged: bool,
    output_flagged: bool,
) -> str:
    if input_flagged:
        return "input"
    if custom_flagged:
        return "custom"
    if output_flagged:
        return "output"
    return "allow"


def azure_migration_window_months(
    deprecated_year: int,
    deprecated_month: int,
    end_year: int,
    end_month: int,
) -> int:
    if deprecated_year < 0 or end_year < 0:
        raise ValueError("Год не может быть отрицательным")
    if not 1 <= deprecated_month <= 12 or not 1 <= end_month <= 12:
        raise ValueError("Некорректный месяц")
    months = (end_year - deprecated_year) * 12 + end_month - deprecated_month
    if months < 0:
        raise ValueError("Дата окончания предшествует дате начала")
    return months
