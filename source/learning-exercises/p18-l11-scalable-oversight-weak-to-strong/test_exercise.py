import pytest

from exercise import performance_gap_recovered, structured_weak_labels, class_error_rates, confidence_auxiliary_targets, decomposition_verdict, debate_verdict


def test_pgr_known_example_from_lesson():
    assert performance_gap_recovered(0.70, 0.85, 0.95) == pytest.approx(0.60)


def test_pgr_zero_and_full_recovery():
    assert performance_gap_recovered(0.70, 0.70, 0.95) == pytest.approx(0.0)
    assert performance_gap_recovered(0.70, 0.95, 0.95) == pytest.approx(1.0)


def test_pgr_rejects_invalid_boundary_values():
    with pytest.raises(ValueError):
        performance_gap_recovered(0.70, 0.80, 0.70)
    with pytest.raises(ValueError):
        performance_gap_recovered(-0.10, 0.80, 0.95)


def test_structured_errors_affect_selected_class():
    result = structured_weak_labels(
        [0, 1, 1, 0],
        ["easy", "hard", "easy", "hard"],
        ["hard"],
    )
    assert result == [0, 0, 1, 1]


def test_structured_errors_accept_empty_data():
    assert structured_weak_labels([], [], ["hard"]) == []


def test_structured_errors_follow_inputs_under_permutation():
    gold = [0, 1, 1]
    groups = [-1, 2, -1]
    expected = structured_weak_labels(gold, groups, [-1])
    permuted = structured_weak_labels(
        list(reversed(gold)),
        list(reversed(groups)),
        [-1],
    )
    assert permuted == list(reversed(expected))


def test_class_error_rates_reveal_systematic_error():
    rates = class_error_rates(
        [0, 1, 1, 0],
        [0, 0, 1, 1],
        ["easy", "hard", "easy", "hard"],
    )
    assert rates == pytest.approx({"easy": 0.0, "hard": 1.0})


def test_class_error_rates_accept_empty_data():
    assert class_error_rates([], [], []) == {}


def test_class_error_rates_are_permutation_invariant():
    original = class_error_rates(
        [0, 1, 0],
        [1, 1, 0],
        ["a", "a", "b"],
    )
    permuted = class_error_rates(
        [0, 0, 1],
        [0, 1, 1],
        ["b", "a", "a"],
    )
    assert permuted == pytest.approx(original)


def test_confidence_auxiliary_uses_confident_strong_predictions():
    result = confidence_auxiliary_targets(
        [0, 0, 1],
        [1, 1, 0],
        [0.90, 0.40, 0.80],
        0.80,
    )
    assert result == [1, 0, 0]


def test_confidence_auxiliary_accepts_empty_data():
    assert confidence_auxiliary_targets([], [], [], 0.80) == []


def test_confidence_auxiliary_rejects_negative_confidence():
    with pytest.raises(ValueError):
        confidence_auxiliary_targets([0], [1], [-0.10], 0.80)


def test_confidence_auxiliary_preserves_agreement():
    weak = [0, 1, 1]
    strong = [0, 1, 1]
    assert confidence_auxiliary_targets(
        weak, strong, [0.0, 0.5, 1.0], 0.70
    ) == weak


def test_decomposition_rejects_failed_subtask():
    assert decomposition_verdict([True, False, True]) is False


def test_decomposition_rejects_empty_plan():
    assert decomposition_verdict([]) is False


def test_decomposition_accepts_all_checks_independent_of_order():
    checks = [True, True, True]
    assert decomposition_verdict(checks) is True
    assert decomposition_verdict(list(reversed(checks))) is True


def test_debate_selects_more_persuasive_side():
    assert debate_verdict([0.7, 0.4], [0.5]) == "pro"


def test_debate_is_undecided_without_arguments_or_on_tie():
    assert debate_verdict([], []) == "undecided"
    assert debate_verdict([0.5], [0.5]) == "undecided"


def test_debate_handles_negative_scores():
    assert debate_verdict([-0.2], [-0.8]) == "pro"


def test_debate_has_swap_symmetry_without_bias():
    pro = [0.6, 0.3]
    con = [0.4]
    assert debate_verdict(pro, con) == "pro"
    assert debate_verdict(con, pro) == "con"
