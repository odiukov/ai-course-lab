def publication_rate(papers: int, researchers: int) -> float:
    if papers < 0 or researchers < 0:
        raise ValueError("Аргументы не могут быть отрицательными")
    if researchers == 0:
        return 0.0
    return papers / researchers


def h_index(citations: list[int]) -> int:
    if any(value < 0 for value in citations):
        raise ValueError("Число цитирований не может быть отрицательным")
    ordered = sorted(citations, reverse=True)
    return sum(value >= rank for rank, value in enumerate(ordered, start=1))


def identify_organization(method: str) -> str:
    normalized = method.strip().lower()
    if "менторств" in normalized:
        return "MATS"
    if "худш" in normalized and "случа" in normalized:
        return "Redwood Research"
    if "схемящ" in normalized:
        return "Apollo Research"
    if "временн" in normalized and "горизонт" in normalized:
        return "METR"
    if "благополуч" in normalized:
        return "Eleos AI Research"
    return "Неизвестно"


def is_external_evaluation(model_creator: str, evaluator: str) -> bool:
    creator = model_creator.strip().lower()
    reviewer = evaluator.strip().lower()
    if not creator or not reviewer:
        return False
    return creator != reviewer


def task_horizon(completed_task_minutes: list[float]) -> float:
    if any(minutes < 0 for minutes in completed_task_minutes):
        raise ValueError("Длительность не может быть отрицательной")
    if not completed_task_minutes:
        return 0.0
    return max(completed_task_minutes)


def can_scheme(
    misaligned: bool,
    goal_directed: bool,
    situation_aware: bool,
) -> bool:
    return bool(misaligned and goal_directed and situation_aware)
