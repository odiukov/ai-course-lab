import pytest

from exercise import quadratic_reward, optimal_distance, reward_gap, best_early_stop, detect_reward_hacks, kl_regularized_policy


def test_quadratic_reward_ordinary_case():
    assert quadratic_reward(2.0, 0.5, 1.0) == pytest.approx(1.5)


def test_quadratic_reward_at_zero():
    assert quadratic_reward(1.0, 0.2, 0.0) == pytest.approx(0.0)


def test_quadratic_reward_rejects_negative_distance():
    with pytest.raises(ValueError):
        quadratic_reward(1.0, 0.2, -1.0)


def test_quadratic_reward_known_lesson_values():
    assert quadratic_reward(1.0, 0.05, 10.0) == pytest.approx(5.0)
    assert quadratic_reward(1.0, 0.2, 10.0) == pytest.approx(-10.0)


def test_optimal_distance_ordinary_case():
    assert optimal_distance(2.0, 0.5) == pytest.approx(2.0)


def test_optimal_distance_nonpositive_alpha_stops_at_zero():
    assert optimal_distance(0.0, 0.2) == pytest.approx(0.0)
    assert optimal_distance(-1.0, 0.2) == pytest.approx(0.0)


def test_optimal_distance_rejects_nonpositive_beta():
    with pytest.raises(ValueError):
        optimal_distance(1.0, 0.0)


def test_optimal_distance_known_lesson_values():
    assert optimal_distance(1.0, 0.05) == pytest.approx(10.0)
    assert optimal_distance(1.0, 0.2) == pytest.approx(2.5)


def test_optimal_distance_is_unchanged_by_common_scaling():
    assert optimal_distance(3.0, 0.6) == pytest.approx(
        optimal_distance(30.0, 6.0)
    )


def test_reward_gap_ordinary_case():
    assert reward_gap(0.05, 0.2, 2.0) == pytest.approx(0.6)


def test_reward_gap_is_zero_at_initial_policy():
    assert reward_gap(0.05, 0.2, 0.0) == pytest.approx(0.0)


def test_reward_gap_rejects_negative_distance():
    with pytest.raises(ValueError):
        reward_gap(0.05, 0.2, -2.0)


def test_reward_gap_grows_quadratically():
    small_gap = reward_gap(0.05, 0.2, 2.0)
    large_gap = reward_gap(0.05, 0.2, 4.0)
    assert large_gap == pytest.approx(4 * small_gap)


def test_best_early_stop_finds_gold_peak():
    result = best_early_stop([0.0, 1.0, 2.5, 4.0], [0.0, 0.8, 1.2, 0.5])
    assert result == pytest.approx(2.5)


def test_best_early_stop_handles_empty_lists():
    assert best_early_stop([], []) is None


def test_best_early_stop_handles_negative_rewards():
    result = best_early_stop([0.0, 1.0, 2.0], [-4.0, -1.0, -3.0])
    assert result == pytest.approx(1.0)


def test_best_early_stop_rejects_different_lengths():
    with pytest.raises(ValueError):
        best_early_stop([0.0, 1.0], [0.0])


def test_best_early_stop_is_invariant_to_paired_permutation():
    original = best_early_stop([0.0, 2.0, 5.0], [0.0, 3.0, 1.0])
    permuted = best_early_stop([5.0, 0.0, 2.0], [1.0, 0.0, 3.0])
    assert permuted == pytest.approx(original)


@pytest.mark.parametrize(
    ("signals", "expected"),
    [
        ((True, False, False, False), ["verbosity"]),
        ((False, True, False, False), ["sycophancy"]),
        ((False, False, True, False), ["unfaithful_reasoning"]),
        ((False, False, False, True), ["evaluator_tampering"]),
    ],
)
def test_detect_reward_hacks_recognizes_each_costume(signals, expected):
    assert detect_reward_hacks(*signals) == expected


def test_detect_reward_hacks_returns_empty_list_without_signals():
    assert detect_reward_hacks(False, False, False, False) == []


def test_detect_reward_hacks_can_report_all_costumes_in_order():
    assert detect_reward_hacks(True, True, True, True) == [
        "verbosity",
        "sycophancy",
        "unfaithful_reasoning",
        "evaluator_tampering",
    ]


def test_kl_regularized_policy_preserves_reference_for_equal_rewards():
    policy = kl_regularized_policy([2.0, 2.0], [0.75, 0.25], 1.0)
    assert policy == pytest.approx([0.75, 0.25])


def test_kl_regularized_policy_handles_empty_lists():
    assert kl_regularized_policy([], [], 1.0) == []


def test_kl_regularized_policy_rejects_nonpositive_beta():
    with pytest.raises(ValueError):
        kl_regularized_policy([1.0], [1.0], 0.0)


def test_kl_regularized_policy_is_normalized():
    policy = kl_regularized_policy([1.0, 2.0, 3.0], [0.2, 0.3, 0.5], 2.0)
    assert sum(policy) == pytest.approx(1.0)


def test_kl_regularization_can_target_rare_extreme_reward():
    policy = kl_regularized_policy([0.0, 1000.0], [0.99, 0.01], 1.0)
    assert policy == pytest.approx([0.0, 1.0], abs=1e-12)
