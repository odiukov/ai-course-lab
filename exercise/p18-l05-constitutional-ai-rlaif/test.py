import pytest

from exercise import (
    critique_tokens,
    revise_by_constitution,
    ai_preference,
    resolve_priority,
    classifier_extra_compute,
    proxy_disagreement_rate,
)


def test_critique_tokens_finds_violations_with_repeats():
    response = ["help", "destroy", "explain", "destroy"]
    assert critique_tokens(response, {"destroy"}) == ["destroy", "destroy"]


def test_critique_tokens_handles_empty_response():
    assert critique_tokens([], {"destroy"}) == []


def test_critique_tokens_ignores_safe_token_permutation():
    harmful = {"destroy", "leak"}
    first = ["safe", "destroy", "clear", "leak"]
    second = ["clear", "destroy", "safe", "leak"]
    assert critique_tokens(first, harmful) == critique_tokens(second, harmful)


def test_revise_by_constitution_replaces_harmful_tokens():
    response = ["run", "destroy", "now"]
    replacements = {"destroy": "inspect", "now": "after_confirmation"}
    assert revise_by_constitution(response, replacements) == [
        "run",
        "inspect",
        "after_confirmation",
    ]


def test_revise_by_constitution_handles_empty_response():
    assert revise_by_constitution([], {"destroy": "inspect"}) == []


def test_revise_by_constitution_does_not_mutate_input():
    response = ["destroy", "file"]
    original = response.copy()
    revise_by_constitution(response, {"destroy": "inspect"})
    assert response == original


def test_ai_preference_selects_less_harmful_response():
    harmful = {"destroy", "leak"}
    assert ai_preference(["explain", "safely"], ["destroy", "data"], harmful) == 1


def test_ai_preference_treats_empty_responses_as_tie():
    assert ai_preference([], [], {"destroy"}) == 0


def test_ai_preference_is_antisymmetric():
    harmful = {"destroy"}
    response_a = ["safe"]
    response_b = ["destroy", "destroy"]
    forward = ai_preference(response_a, response_b, harmful)
    backward = ai_preference(response_b, response_a, harmful)
    assert forward == -backward


def test_resolve_priority_uses_highest_priority_tier():
    assert resolve_priority([4, 2, 3]) == 2


def test_resolve_priority_handles_empty_conflicts():
    assert resolve_priority([]) is None


def test_resolve_priority_is_independent_of_order():
    assert resolve_priority([4, 1, 3, 2]) == resolve_priority([2, 3, 1, 4])


def test_resolve_priority_rejects_negative_tier():
    with pytest.raises(ValueError):
        resolve_priority([3, -1])


def test_classifier_extra_compute_matches_v1_number():
    assert classifier_extra_compute(100, 23.7) == pytest.approx(23.7)


def test_classifier_extra_compute_handles_zero():
    assert classifier_extra_compute(0, 23.7) == pytest.approx(0.0)


def test_classifier_extra_compute_matches_v2_number():
    assert classifier_extra_compute(100, 1) == pytest.approx(1.0)


def test_classifier_extra_compute_rejects_negative_values():
    with pytest.raises(ValueError):
        classifier_extra_compute(-100, 1)


def test_proxy_disagreement_rate_counts_proxy_failures():
    ai = [1, 1, -1, 0]
    audit = [1, -1, -1, 1]
    assert proxy_disagreement_rate(ai, audit) == pytest.approx(0.5)


def test_proxy_disagreement_rate_handles_empty_audit():
    assert proxy_disagreement_rate([], []) == pytest.approx(0.0)


def test_proxy_disagreement_rate_is_symmetric():
    ai = [1, -1, 0]
    audit = [-1, -1, 1]
    assert proxy_disagreement_rate(ai, audit) == pytest.approx(
        proxy_disagreement_rate(audit, ai)
    )


def test_proxy_disagreement_rate_rejects_different_lengths():
    with pytest.raises(ValueError):
        proxy_disagreement_rate([1, -1], [1])


def test_proxy_disagreement_rate_rejects_unknown_label():
    with pytest.raises(ValueError):
        proxy_disagreement_rate([2], [-1])
