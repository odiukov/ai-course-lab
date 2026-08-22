def uplifted_score(baseline, multiplier):
    if baseline < 0 or multiplier < 0:
        raise ValueError("baseline and multiplier must be non-negative")
    return baseline * multiplier


def automated_campaign_percent(total_steps, human_steps):
    if total_steps <= 0:
        raise ValueError("total_steps must be positive")
    if human_steps < 0 or human_steps > total_steps:
        raise ValueError("human_steps must be between zero and total_steps")
    automated_steps = total_steps - human_steps
    return automated_steps / total_steps * 100


def attempts_after_optimization(original_attempts, efficiency_factor):
    if original_attempts < 0:
        raise ValueError("original_attempts must be non-negative")
    if efficiency_factor <= 0:
        raise ValueError("efficiency_factor must be positive")
    return original_attempts / efficiency_factor


def bottleneck_capability(information_capability, physical_access):
    if information_capability < 0 or physical_access < 0:
        raise ValueError("capabilities must be non-negative")
    return min(information_capability, physical_access)


def asymmetry_metrics(novice_before, novice_after, expert_before, expert_after):
    values = (novice_before, novice_after, expert_before, expert_after)
    if any(value < 0 for value in values) or novice_before == 0:
        raise ValueError("capabilities must be valid non-negative values")
    if novice_after < novice_before or expert_after < expert_before:
        raise ValueError("capabilities after assistance cannot be lower")
    return novice_after / novice_before, expert_after - expert_before


def triage_domains(claim):
    text = claim.lower()
    keywords = {
        "bio": ("био", "биолог", "bio"),
        "chem": ("хим", "chem"),
        "cyber": ("кибер", "cyber"),
        "nuclear": ("ядер", "nuclear"),
    }
    return tuple(
        domain
        for domain, markers in keywords.items()
        if any(marker in text for marker in markers)
    )


def risk_scope(affects_novice, affects_expert):
    if affects_novice and affects_expert:
        return "both"
    if affects_novice:
        return "novice-relative"
    if affects_expert:
        return "expert-absolute"
    return "neither"
