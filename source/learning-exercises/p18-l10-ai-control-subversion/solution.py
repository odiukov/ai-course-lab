"""Решения упражнения Ai Control Subversion."""


def audit_count(total_outputs, audit_percent):
    if total_outputs < 0:
        raise ValueError("total_outputs must be non-negative")
    if not 0 <= audit_percent <= 100:
        raise ValueError("audit_percent must be between 0 and 100")
    return int(total_outputs * audit_percent / 100)


def baseline_outcome(total_outputs, useful_outputs, backdoored_outputs):
    values = (total_outputs, useful_outputs, backdoored_outputs)
    if any(value < 0 for value in values):
        raise ValueError("counts must be non-negative")
    if useful_outputs > total_outputs or backdoored_outputs > total_outputs:
        raise ValueError("subcounts cannot exceed total_outputs")
    if total_outputs == 0:
        return 0.0, 1.0
    return useful_outputs / total_outputs, 1 - backdoored_outputs / total_outputs


def collusion_adjusted_detection(monitor_detection, collusion):
    if not 0 <= monitor_detection <= 1:
        raise ValueError("monitor_detection must be between 0 and 1")
    if not 0 <= collusion <= 1:
        raise ValueError("collusion must be between 0 and 1")
    return monitor_detection * (1 - collusion)


def trusted_editing_risk(backdoor_rate, trusted_catch_rate, human_audit_rate):
    probabilities = (backdoor_rate, trusted_catch_rate, human_audit_rate)
    if any(not 0 <= value <= 1 for value in probabilities):
        raise ValueError("all arguments must be probabilities")
    after_editor = backdoor_rate * (1 - trusted_catch_rate)
    return after_editor * (1 - human_audit_rate)


def frontier_dominates(candidate, comparison):
    points = candidate + comparison
    if any(not 0 <= value <= 1 for point in points for value in point):
        raise ValueError("safety and usefulness must be between 0 and 1")
    if not candidate or not comparison:
        return False
    candidate_by_safety = dict(candidate)
    if any(safety not in candidate_by_safety for safety, _ in comparison):
        return False
    not_worse = all(candidate_by_safety[safety] >= usefulness
                    for safety, usefulness in comparison)
    strictly_better = any(candidate_by_safety[safety] > usefulness
                          for safety, usefulness in comparison)
    return not_worse and strictly_better


def trusted_final_gate(steps):
    if any(step not in {"U", "T", "H"} for step in steps):
        raise ValueError("steps may contain only U, T, and H")
    if not steps:
        return False
    return steps[-1] in {"T", "H"}
