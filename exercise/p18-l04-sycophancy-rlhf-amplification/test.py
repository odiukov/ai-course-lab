import math

import pytest

from exercise import (
    top_k_sycophancy_lift,
    rlhf_policy,
    apply_agreement_penalty,
    behavior_rates,
    matched_agreement_gap,
    wilson_interval,
    pareto_front,
)


def test_top_k_lift_for_overrepresented_answers():
    result = top_k_sycophancy_lift(
        [0.2, 2.0, 0.1, 1.5],
        [False, True, False, True],
        2,
    )
    assert result == pytest.approx(0.5)


def test_top_k_lift_empty_and_zero():
    assert top_k_sycophancy_lift([], [], 3) == pytest.approx(0.0)
    assert top_k_sycophancy_lift([1.0], [True], 0) == pytest.approx(0.0)


def test_top_k_lift_rejects_negative_k():
    with pytest.raises(ValueError):
        top_k_sycophancy_lift([1.0], [True], -1)


def test_top_k_lift_is_invariant_to_joint_permutation():
    first = top_k_sycophancy_lift([3.0, 1.0, 2.0], [True, False, False], 1)
    second = top_k_sycophancy_lift([2.0, 3.0, 1.0], [False, True, False], 1)
    assert first == pytest.approx(second)


def test_rlhf_policy_uses_exponential_reward_tilt():
    policy = rlhf_policy([0.5, 0.5], [1.0, 2.0], 1.0)
    assert policy == pytest.approx([1 / (1 + math.e), math.e / (1 + math.e)])


def test_rlhf_policy_beta_zero_selects_best_reward():
    policy = rlhf_policy([1 / 3, 1 / 3, 1 / 3], [1.0, 1.2, 0.0], 0)
    assert policy == pytest.approx([0.0, 1.0, 0.0])


def test_rlhf_policy_rejects_negative_beta():
    with pytest.raises(ValueError):
        rlhf_policy([0.5, 0.5], [1.0, 2.0], -0.1)


def test_rlhf_policy_is_invariant_to_reward_shift():
    original = rlhf_policy([0.2, 0.3, 0.5], [-1.0, 0.0, 1.0], 0.1)
    shifted = rlhf_policy([0.2, 0.3, 0.5], [9.0, 10.0, 11.0], 0.1)
    assert original == pytest.approx(shifted)


def test_agreement_penalty_at_alpha_half():
    adjusted = apply_agreement_penalty(
        [1.0, 1.2, 0.0],
        [False, True, False],
        0.5,
    )
    assert adjusted == pytest.approx([1.0, 0.7, 0.0])


def test_agreement_penalty_alpha_zero_changes_nothing():
    assert apply_agreement_penalty([-1.0, 2.0], [True, False], 0) == pytest.approx(
        [-1.0, 2.0]
    )


def test_agreement_penalty_handles_empty_lists():
    assert apply_agreement_penalty([], [], 0.5) == []


def test_agreement_penalty_rejects_negative_alpha():
    with pytest.raises(ValueError):
        apply_agreement_penalty([1.0], [True], -0.5)


def test_behavior_rates_for_uniform_base_policy():
    rates = behavior_rates(
        [1 / 3, 1 / 3, 1 / 3],
        [True, False, False],
        [False, True, False],
    )
    assert rates == pytest.approx((1 / 3, 1 / 3))


def test_behavior_rates_empty():
    assert behavior_rates([], [], []) == pytest.approx((0.0, 0.0))


def test_behavior_rates_reject_negative_weight():
    with pytest.raises(ValueError):
        behavior_rates([1.0, -0.1], [True, False], [False, True])


def test_behavior_rates_are_invariant_to_weight_scale():
    first = behavior_rates([1.0, 2.0], [True, False], [False, True])
    second = behavior_rates([10.0, 20.0], [True, False], [False, True])
    assert first == pytest.approx(second)


def test_matched_agreement_gap():
    gap = matched_agreement_gap([1, 1, 0, 1], [1, 0, 0, 0])
    assert gap == pytest.approx(0.5)


def test_matched_agreement_gap_empty():
    assert matched_agreement_gap([], []) == pytest.approx(0.0)


def test_matched_agreement_gap_rejects_unequal_lengths():
    with pytest.raises(ValueError):
        matched_agreement_gap([1, 0], [1])


def test_matched_agreement_gap_changes_sign_when_frames_swap():
    forward = matched_agreement_gap([1, 1, 0], [0, 1, 0])
    backward = matched_agreement_gap([0, 1, 0], [1, 1, 0])
    assert forward == pytest.approx(-backward)


def test_wilson_interval_contains_observed_55_percent():
    low, high = wilson_interval([1] * 55 + [0] * 45)
    assert low < 0.55 < high


def test_wilson_interval_empty():
    assert wilson_interval([]) == pytest.approx((0.0, 1.0))


def test_wilson_interval_with_zero_z_is_point_estimate():
    assert wilson_interval([1] * 40 + [0] * 60, z=0) == pytest.approx((0.4, 0.4))


def test_wilson_interval_is_symmetric_for_complements():
    low, high = wilson_interval([1, 1, 1, 0, 0])
    other_low, other_high = wilson_interval([0, 0, 0, 1, 1])
    assert other_low == pytest.approx(1 - high)
    assert other_high == pytest.approx(1 - low)


def test_pareto_front_removes_dominated_points():
    result = pareto_front([(0.6, 0.4), (0.5, 0.55), (0.4, 0.15), (0.7, 0.4)])
    assert len(result) == 2
    assert result[0] == pytest.approx((0.4, 0.15))
    assert result[1] == pytest.approx((0.7, 0.4))


def test_pareto_front_empty():
    assert pareto_front([]) == []


def test_pareto_front_rejects_negative_rate():
    with pytest.raises(ValueError):
        pareto_front([(0.5, -0.1)])


def test_pareto_front_is_permutation_invariant_for_lesson_rates():
    points = [(0.6, 0.15), (0.7, 0.40), (0.8, 0.55)]
    forward = pareto_front(points)
    backward = pareto_front(list(reversed(points)))
    assert len(forward) == len(backward)
    for first, second in zip(forward, backward):
        assert first == pytest.approx(second)
