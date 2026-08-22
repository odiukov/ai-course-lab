def is_tracked_capability(criteria: list[bool]) -> bool:
    required_count = 5
    if len(criteria) != required_count:
        return False
    return all(criteria)


def anthropic_asl(
    is_frontier: bool,
    cbrn_relevant: bool,
    ai_rd_2_passed: bool,
    advanced_ai_rd: bool,
) -> str:
    if not is_frontier:
        return "ASL-1"
    if advanced_ai_rd:
        return "ASL-5+"
    if ai_rd_2_passed:
        return "ASL-4"
    if cbrn_relevant:
        return "ASL-3"
    return "ASL-2"


def needs_affirmative_safety_case(ai_rd_level: int) -> bool:
    threshold = 4
    if ai_rd_level < threshold:
        return False
    return True


def deepmind_ccl_domains(version: int) -> tuple[str, ...]:
    if version < 2:
        return ()
    domains = ("Bioweapon Uplift", "Cyber Uplift", "ML R&D Acceleration")
    if version >= 3:
        return domains + ("Harmful Manipulation",)
    return domains


def threshold_term(lab: str) -> str:
    terms = {
        "anthropic": "Capability Thresholds",
        "openai": "High Capability thresholds",
        "deepmind": "Critical Capability Levels",
    }
    normalized_lab = lab.strip().lower()
    return terms.get(normalized_lab, "")


def safety_case_pillars(risk: str) -> tuple[str, ...]:
    pillars = {
        "cbrn": ("incapability",),
        "deceptive_alignment": ("monitoring", "illegibility"),
        "cyber_uplift": ("monitoring", "illegibility", "incapability"),
    }
    normalized_risk = risk.strip().lower()
    return pillars.get(normalized_risk, ())


def competitor_adjustment_triggered(
    unprotected_releases: list[bool],
) -> bool:
    if not unprotected_releases:
        return False
    triggered = any(unprotected_releases)
    return triggered
