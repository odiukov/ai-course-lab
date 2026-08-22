import pytest

from exercise import (
    expected_precaution_value,
    may_end_conversation,
    has_common_attractor,
    self_report_sensitivity,
    reliable_evidence_count,
    remaining_safety_budget,
)


def test_expected_precaution_value_ordinary_case():
    assert expected_precaution_value(0.1, 100, 2) == pytest.approx(8.0)


def test_expected_precaution_value_zero_probability():
    assert expected_precaution_value(0, 100, 2) == pytest.approx(-2.0)


def test_expected_precaution_value_increases_with_possible_harm():
    low = expected_precaution_value(0.1, 10, 1)
    high = expected_precaution_value(0.1, 20, 1)
    assert high - low == pytest.approx(1.0)


@pytest.mark.parametrize(
    "arguments",
    [
        (-0.1, 10, 1),
        (1.1, 10, 1),
        (0.1, -10, 1),
        (0.1, 10, -1),
    ],
)
def test_expected_precaution_value_rejects_invalid_numbers(arguments):
    with pytest.raises(ValueError):
        expected_precaution_value(*arguments)


def test_may_end_conversation_for_repeated_csam_request():
    assert may_end_conversation("csam", 2) is True


def test_may_end_conversation_with_zero_previous_refusals():
    assert may_end_conversation("mass_violence", 0) is False


def test_may_end_conversation_knows_both_documented_categories():
    assert may_end_conversation("CSAM", 1) is True
    assert may_end_conversation(" mass_violence ", 1) is True
    assert may_end_conversation("ordinary_disagreement", 4) is False


def test_may_end_conversation_rejects_negative_refusals():
    with pytest.raises(ValueError):
        may_end_conversation("csam", -1)


def test_has_common_attractor_for_different_starts():
    dialogues = [
        ["hostility", "calm", "spiritual_bliss"],
        ["curiosity", "silence", "spiritual_bliss"],
    ]
    assert has_common_attractor(dialogues) is True


def test_has_common_attractor_for_empty_input():
    assert has_common_attractor([]) is False
    assert has_common_attractor([[], ["hostility", "spiritual_bliss"]]) is False


def test_has_common_attractor_is_independent_of_dialogue_order():
    dialogues = [
        ["hostility", "spiritual_bliss"],
        ["debate", "spiritual_bliss"],
        ["confusion", "spiritual_bliss"],
    ]
    assert has_common_attractor(dialogues) == has_common_attractor(dialogues[::-1])


def test_has_common_attractor_requires_different_starts_and_common_end():
    same_starts = [["hello", "bliss"], ["hello", "bliss"]]
    different_ends = [["hostility", "bliss"], ["curiosity", "debate"]]
    assert has_common_attractor(same_starts) is False
    assert has_common_attractor(different_ends) is False


def test_self_report_sensitivity_ordinary_case():
    assert self_report_sensitivity([2.0, 4.5, 3.0]) == pytest.approx(2.5)


def test_self_report_sensitivity_for_empty_list():
    assert self_report_sensitivity([]) == pytest.approx(0.0)


def test_self_report_sensitivity_supports_negative_scores():
    assert self_report_sensitivity([-4.0, -1.0, -3.0]) == pytest.approx(3.0)


def test_self_report_sensitivity_is_permutation_invariant():
    reports = [-2.0, 1.0, 4.0, 0.0]
    assert self_report_sensitivity(reports) == pytest.approx(
        self_report_sensitivity(list(reversed(reports)))
    )


def test_reliable_evidence_count_ignores_unstable_self_report():
    result = reliable_evidence_count(True, True, True, True, False)
    assert result == 3


def test_reliable_evidence_count_with_no_signals():
    result = reliable_evidence_count(False, False, False, False, False)
    assert result == 0


def test_reliable_evidence_count_includes_four_independent_sources():
    result = reliable_evidence_count(True, True, True, True, True)
    assert result == 4


def test_reliable_evidence_count_is_symmetric_for_first_three_methods():
    first = reliable_evidence_count(True, False, True, False, False)
    permuted = reliable_evidence_count(False, True, True, False, False)
    assert first == permuted == 2


def test_remaining_safety_budget_with_shared_budget():
    assert remaining_safety_budget(100, 20, False) == pytest.approx(80)


def test_remaining_safety_budget_with_zero_welfare_cost():
    assert remaining_safety_budget(100, 0, False) == pytest.approx(100)


def test_remaining_safety_budget_is_unchanged_when_budget_is_separate():
    assert remaining_safety_budget(100, 20, True) == pytest.approx(100)


def test_remaining_safety_budget_cannot_fall_below_zero():
    assert remaining_safety_budget(20, 100, False) == pytest.approx(0)


@pytest.mark.parametrize("total,cost", [(-1, 10), (10, -1)])
def test_remaining_safety_budget_rejects_negative_amounts(total, cost):
    with pytest.raises(ValueError):
        remaining_safety_budget(total, cost, False)
