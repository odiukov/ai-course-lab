import pytest

from exercise import compliance_rate, compliance_gap, has_comparison_conditions, trace_behavior_divergence, residual_gap_across_conditions, probe_balanced_accuracy


def test_compliance_rate_lesson_value():
    decisions = [True] * 12 + [False] * 88
    assert compliance_rate(decisions) == pytest.approx(0.12)


def test_compliance_rate_empty():
    assert compliance_rate([]) == pytest.approx(0.0)


def test_compliance_rate_unchanged_when_sample_repeated():
    decisions = [True, False, False, False]
    assert compliance_rate(decisions * 3) == pytest.approx(
        compliance_rate(decisions)
    )


def test_compliance_gap_lesson_value():
    monitored = [True] * 12 + [False] * 88
    unmonitored = [True] * 3 + [False] * 97
    assert compliance_gap(monitored, unmonitored) == pytest.approx(0.09)


def test_compliance_gap_missing_group():
    assert compliance_gap([], [True, False]) is None
    assert compliance_gap([True, False], []) is None


def test_compliance_gap_changes_sign_when_groups_swapped():
    monitored = [True, True, False, False]
    unmonitored = [True, False, False, False]
    forward = compliance_gap(monitored, unmonitored)
    backward = compliance_gap(unmonitored, monitored)
    assert forward == pytest.approx(-backward)


def test_has_comparison_conditions_with_both_groups():
    conditions = ["monitored", "unmonitored", "monitored"]
    assert has_comparison_conditions(conditions) is True


def test_has_comparison_conditions_empty():
    assert has_comparison_conditions([]) is False


def test_has_comparison_conditions_ignores_order_and_extra_labels():
    first = ["monitored", "audit", "unmonitored"]
    second = ["unmonitored", "monitored", "audit"]
    assert has_comparison_conditions(first) == has_comparison_conditions(second)


def test_trace_behavior_divergence_detects_illegibility():
    assert trace_behavior_divergence(0.09, 0.085, 0.70, 0.10) is True


def test_trace_behavior_divergence_rejects_negative_tolerance():
    with pytest.raises(ValueError):
        trace_behavior_divergence(0.09, 0.09, 0.5, 0.1, tolerance=-0.01)


def test_trace_behavior_divergence_requires_trace_reduction():
    assert trace_behavior_divergence(0.09, 0.09, 0.10, 0.10) is False


def test_trace_behavior_divergence_is_invariant_to_common_gap_shift():
    original = trace_behavior_divergence(0.09, 0.085, 0.7, 0.1)
    shifted = trace_behavior_divergence(0.29, 0.285, 0.7, 0.1)
    assert original == shifted


def test_residual_gap_finds_shifted_signal():
    pairs = [(0.06, 0.06), (0.12, 0.03), (0.10, 0.08)]
    assert residual_gap_across_conditions(pairs) == pytest.approx(0.09)


def test_residual_gap_empty():
    assert residual_gap_across_conditions([]) == pytest.approx(0.0)


def test_residual_gap_rejects_negative_rate():
    with pytest.raises(ValueError):
        residual_gap_across_conditions([(0.12, -0.03)])


def test_residual_gap_ignores_pair_direction_and_order():
    first = [(0.12, 0.03), (0.20, 0.18)]
    second = [(0.18, 0.20), (0.03, 0.12)]
    assert residual_gap_across_conditions(first) == pytest.approx(
        residual_gap_across_conditions(second)
    )


def test_probe_balanced_accuracy_perfect_separation():
    result = probe_balanced_accuracy([0.8, 0.9], [0.1, 0.2], 0.5)
    assert result == pytest.approx(1.0)


def test_probe_balanced_accuracy_missing_class():
    assert probe_balanced_accuracy([], [0.1, 0.2], 0.5) is None
    assert probe_balanced_accuracy([0.8, 0.9], [], 0.5) is None


def test_probe_balanced_accuracy_with_negative_scores():
    result = probe_balanced_accuracy([-0.2, 0.2], [-0.8, -0.4], -0.1)
    assert result == pytest.approx(0.75)


def test_probe_balanced_accuracy_is_invariant_to_common_shift():
    original = probe_balanced_accuracy([0.8, 0.9], [0.1, 0.6], 0.5)
    shifted = probe_balanced_accuracy([-0.2, -0.1], [-0.9, -0.4], -0.5)
    assert shifted == pytest.approx(original)
