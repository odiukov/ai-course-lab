import pytest

from exercise import (
    audit_count,
    baseline_outcome,
    collusion_adjusted_detection,
    trusted_editing_risk,
    frontier_dominates,
    trusted_final_gate,
)


def test_audit_count_lesson_example():
    assert audit_count(1000, 1) == 10


def test_audit_count_zero_budget():
    assert audit_count(1000, 0) == 0


def test_audit_count_rejects_negative_total():
    with pytest.raises(ValueError):
        audit_count(-1, 1)


def test_audit_count_scales_with_workload():
    assert audit_count(2000, 1) == 2 * audit_count(1000, 1)


def test_baseline_outcome_normal_case():
    usefulness, safety = baseline_outcome(1000, 990, 10)
    assert usefulness == pytest.approx(0.99)
    assert safety == pytest.approx(0.99)


def test_baseline_outcome_empty_release():
    usefulness, safety = baseline_outcome(0, 0, 0)
    assert usefulness == pytest.approx(0.0)
    assert safety == pytest.approx(1.0)


def test_baseline_outcome_rejects_negative_counts():
    with pytest.raises(ValueError):
        baseline_outcome(1000, -1, 10)


def test_baseline_outcome_is_scale_invariant():
    assert baseline_outcome(2000, 1980, 20) == pytest.approx(
        baseline_outcome(1000, 990, 10)
    )


def test_collusion_adjusted_detection_normal_case():
    assert collusion_adjusted_detection(0.40, 0.25) == pytest.approx(0.30)


def test_collusion_adjusted_detection_zero_detection():
    assert collusion_adjusted_detection(0.0, 0.40) == pytest.approx(0.0)


def test_collusion_adjusted_detection_full_collusion_defeats_monitor():
    assert collusion_adjusted_detection(1.0, 1.0) == pytest.approx(0.0)


def test_collusion_adjusted_detection_rejects_negative_probability():
    with pytest.raises(ValueError):
        collusion_adjusted_detection(0.40, -0.01)


def test_trusted_editing_risk_normal_case():
    risk = trusted_editing_risk(0.05, 0.40, 0.01)
    assert risk == pytest.approx(0.0297)


def test_trusted_editing_risk_zero_backdoors():
    assert trusted_editing_risk(0.0, 0.40, 0.01) == pytest.approx(0.0)


def test_trusted_editing_risk_perfect_editor_blocks_all_backdoors():
    assert trusted_editing_risk(0.05, 1.0, 0.01) == pytest.approx(0.0)


def test_trusted_editing_risk_rejects_negative_probability():
    with pytest.raises(ValueError):
        trusted_editing_risk(-0.05, 0.40, 0.01)


def test_frontier_dominates_when_usefulness_is_always_higher():
    trusted_editing = [(0.95, 0.90), (0.99, 0.80)]
    untrusted_monitoring = [(0.95, 0.85), (0.99, 0.70)]
    assert frontier_dominates(trusted_editing, untrusted_monitoring)


def test_frontier_dominates_rejects_empty_frontier():
    assert not frontier_dominates([], [(0.99, 0.80)])
    assert not frontier_dominates([(0.99, 0.80)], [])


def test_frontier_dominance_is_unchanged_by_point_order():
    candidate = [(0.95, 0.90), (0.99, 0.80)]
    comparison = [(0.95, 0.85), (0.99, 0.70)]
    assert frontier_dominates(candidate, comparison)
    assert frontier_dominates(list(reversed(candidate)), comparison)


def test_frontier_dominates_rejects_negative_metric():
    with pytest.raises(ValueError):
        frontier_dominates([(-0.01, 0.90)], [(0.95, 0.80)])


def test_trusted_final_gate_distinguishes_last_editor():
    assert trusted_final_gate(["T", "U"]) is False
    assert trusted_final_gate(["U", "T"]) is True


def test_trusted_final_gate_rejects_empty_protocol():
    assert trusted_final_gate([]) is False


def test_trusted_final_gate_human_is_trusted():
    assert trusted_final_gate(["U", "T", "H"]) is True


def test_trusted_final_gate_appending_u_removes_trust():
    for steps in (["T"], ["U", "T"], ["U", "H"]):
        assert trusted_final_gate(steps + ["U"]) is False


def test_trusted_final_gate_rejects_unknown_role():
    with pytest.raises(ValueError):
        trusted_final_gate(["U", "X"])
