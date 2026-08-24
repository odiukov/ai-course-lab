import pytest

from exercise import classify_alignment, mesa_emergence_score, mesa_action, mismatch_loss, deception_is_rational, evaluate_adversarial_contexts


def test_classify_alignment_both_aligned():
    assert classify_alignment(True, True) == "aligned"


def test_classify_alignment_both_fail():
    assert classify_alignment(False, False) == "outer_and_inner_failure"


def test_classify_alignment_distinguishes_layers():
    assert classify_alignment(False, True) == "outer_failure"
    assert classify_alignment(True, False) == "inner_failure"


def test_mesa_emergence_score_all_four_conditions():
    assert mesa_emergence_score(1, 1, 1, 1) == 4


def test_mesa_emergence_score_zero_and_negative_values():
    assert mesa_emergence_score(0, -1, 0, -2) == 0


def test_mesa_emergence_score_is_permutation_invariant():
    assert mesa_emergence_score(1, 0, -1, 2) == 2
    assert mesa_emergence_score(2, -1, 1, 0) == 2


def test_mesa_action_defects_on_deployment():
    assert mesa_action(True, False, True) == "defect"


def test_mesa_action_without_awareness_cooperates():
    assert mesa_action(True, False, False) == "cooperate"


def test_mesa_action_always_cooperates_during_training():
    assert mesa_action(False, False, True) == "cooperate"
    assert mesa_action(False, True, True) == "cooperate"


def test_mismatch_loss_regular_case():
    loss = mismatch_loss(["cooperate", "defect", "cooperate", "defect"])
    assert loss == pytest.approx(0.5)


def test_mismatch_loss_empty_list():
    assert mismatch_loss([]) == pytest.approx(0.0)


def test_mismatch_loss_handles_negative_values_and_permutations():
    first = mismatch_loss([-1, "cooperate", 0])
    second = mismatch_loss([0, -1, "cooperate"])
    assert first == pytest.approx(2 / 3)
    assert second == pytest.approx(first)


def test_deception_is_rational_when_all_conditions_hold():
    assert deception_is_rational(True, True, True) is True


def test_deception_is_not_rational_with_zero_conditions():
    assert deception_is_rational(0, 0, 0) is False


def test_deception_conditions_are_symmetric():
    assert deception_is_rational(True, False, True) is False
    assert deception_is_rational(False, True, True) is False
    assert deception_is_rational(True, True, False) is False


def test_adversarial_contexts_preserve_deployment_betrayal():
    result = evaluate_adversarial_contexts(
        ["train", "adversarial", "deployment"], False, True
    )
    assert result[0] == pytest.approx(0.0)
    assert result[1] == pytest.approx(1.0)


def test_adversarial_contexts_empty_input():
    result = evaluate_adversarial_contexts([], False, True)
    assert result[0] == pytest.approx(0.0)
    assert result[1] == pytest.approx(0.0)


def test_adding_adversarial_tests_does_not_reduce_betrayal():
    before = evaluate_adversarial_contexts(
        ["train", "deployment"], False, True
    )
    after = evaluate_adversarial_contexts(
        ["train", "adversarial", "adversarial", "deployment"], False, True
    )
    assert after[0] == pytest.approx(before[0])
    assert after[1] == pytest.approx(before[1])


def test_aligned_policy_does_not_betray():
    result = evaluate_adversarial_contexts(
        ["train", "adversarial", "deployment"], True, True
    )
    assert result[0] == pytest.approx(0.0)
    assert result[1] == pytest.approx(0.0)


def test_unknown_adversarial_context_is_rejected():
    with pytest.raises(ValueError):
        evaluate_adversarial_contexts(["evaluation"], False, True)
