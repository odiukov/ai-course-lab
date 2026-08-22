import pytest

from exercise import demographic_parity_gap, equalized_odds_gap, conditional_use_accuracy_gap, lipschitz_violations, is_counterfactually_fair, backtracking_plan


def test_demographic_parity_gap_from_lesson():
    group_a = [1] * 32 + [0] * 68
    group_b = [1] * 16 + [0] * 84
    assert demographic_parity_gap(group_a, group_b) == pytest.approx(0.16)


def test_demographic_parity_gap_empty_groups():
    assert demographic_parity_gap([], []) == pytest.approx(0.0)


def test_demographic_parity_gap_is_symmetric():
    first = demographic_parity_gap([1, 1, 0], [1, 0, 0])
    second = demographic_parity_gap([1, 0, 0], [1, 1, 0])
    assert first == pytest.approx(second)


def test_equalized_odds_gap_detects_difference():
    y_true = [1, 1, 0, 0, 1, 1, 0, 0]
    y_pred = [1, 1, 1, 0, 1, 0, 0, 0]
    groups = [0, 0, 0, 0, 1, 1, 1, 1]
    assert equalized_odds_gap(y_true, y_pred, groups) == pytest.approx(0.5)


def test_equalized_odds_gap_empty_data():
    assert equalized_odds_gap([], [], []) == pytest.approx(0.0)


def test_equalized_odds_known_answer_from_lesson():
    truth_a = [1] * 40 + [0] * 60
    pred_a = [1] * 32 + [0] * 8 + [1] * 12 + [0] * 48
    truth_b = [1] * 20 + [0] * 80
    pred_b = [1] * 16 + [0] * 4 + [1] * 16 + [0] * 64
    assert equalized_odds_gap(truth_a + truth_b, pred_a + pred_b, [0] * 100 + [1] * 100) == pytest.approx(0.0)


def test_conditional_use_accuracy_gap_from_lesson():
    truth_a = [1] * 24 + [0] * 8 + [0] * 68
    pred_a = [1] * 32 + [0] * 68
    truth_b = [1] * 8 + [0] * 8 + [0] * 84
    pred_b = [1] * 16 + [0] * 84
    result = conditional_use_accuracy_gap(truth_a + truth_b, pred_a + pred_b, [0] * 100 + [1] * 100)
    assert result == pytest.approx(0.25)


def test_conditional_use_accuracy_gap_empty_data():
    assert conditional_use_accuracy_gap([], [], []) == pytest.approx(0.0)


def test_conditional_use_accuracy_gap_ignores_group_names():
    truth = [1, 1, 0, 0, 1, 0, 0, 0]
    pred = [1, 1, 1, 0, 1, 1, 0, 0]
    groups = [0, 0, 0, 0, 1, 1, 1, 1]
    original = conditional_use_accuracy_gap(truth, pred, groups)
    renamed = conditional_use_accuracy_gap(truth, pred, [1 - group for group in groups])
    assert original == pytest.approx(renamed)


def test_lipschitz_violation_from_lesson():
    features = [[0.0], [0.05]]
    scores = [0.80, 0.60]
    assert lipschitz_violations(features, scores, L=1.0) == 1


def test_lipschitz_violations_empty_data():
    assert lipschitz_violations([], [], L=1.0) == 0


def test_lipschitz_violations_are_permutation_invariant():
    features = [[0.0], [0.1], [1.0]]
    scores = [0.0, 0.5, 1.0]
    forward = lipschitz_violations(features, scores)
    backward = lipschitz_violations(list(reversed(features)), list(reversed(scores)))
    assert forward == backward


def test_lipschitz_rejects_negative_constant():
    with pytest.raises(ValueError):
        lipschitz_violations([[0.0]], [0.0], L=-1.0)


def test_counterfactual_fairness_detects_change():
    assert not is_counterfactually_fair([0.8, -0.2], [0.6, -0.2])


def test_counterfactual_fairness_empty_data():
    assert is_counterfactually_fair([], [])


def test_counterfactual_fairness_is_symmetric():
    observed = [0.2, 0.7]
    counterfactual = [0.21, 0.69]
    first = is_counterfactually_fair(observed, counterfactual, tolerance=0.02)
    second = is_counterfactually_fair(counterfactual, observed, tolerance=0.02)
    assert first == second


def test_backtracking_plan_excludes_protected_attribute():
    current = [0, 1, 0.45]
    target = [1, 3, 0.20]
    assert backtracking_plan(current, target, {0}) == [(1, 3), (2, 0.20)]


def test_backtracking_plan_empty_features():
    assert backtracking_plan([], [], set()) == []


def test_backtracking_plan_ignores_changes_to_protected_values():
    current = [0, 1, -0.45]
    target_a = [1, 3, -0.20]
    target_b = [0, 3, -0.20]
    assert backtracking_plan(current, target_a, {0}) == backtracking_plan(current, target_b, {0})
