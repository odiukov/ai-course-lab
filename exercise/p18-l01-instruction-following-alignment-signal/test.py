from exercise import sft_policy, bradley_terry_loss, kl_divergence, rlhf_objective, kl_anchored_policy, alignment_tax, ppo_ptx_objective

import math

import pytest


def test_sft_policy_copies_200_demonstrations():
    demonstrations = ["A"] * 120 + ["B"] * 60 + ["C"] * 20
    assert sft_policy(demonstrations) == pytest.approx(
        {"A": 0.6, "B": 0.3, "C": 0.1}
    )


def test_sft_policy_is_uniform_without_demonstrations():
    assert sft_policy([]) == pytest.approx(
        {"A": 1 / 3, "B": 1 / 3, "C": 1 / 3}
    )


def test_sft_policy_does_not_depend_on_demonstration_order():
    first = sft_policy(["A", "B", "A", "C"])
    second = sft_policy(["C", "A", "B", "A"])
    assert first == pytest.approx(second)


def test_bradley_terry_loss_uses_lesson_rewards():
    loss = bradley_terry_loss(1.8, 0.3)
    assert loss == pytest.approx(0.2014132779827524)


def test_bradley_terry_loss_for_equal_rewards():
    assert bradley_terry_loss(0.0, 0.0) == pytest.approx(math.log(2))


def test_bradley_terry_loss_is_invariant_to_shared_shift():
    original = bradley_terry_loss(1.8, 0.3)
    shifted = bradley_terry_loss(-8.2, -9.7)
    assert shifted == pytest.approx(original)


def test_kl_divergence_for_different_policies():
    result = kl_divergence([0.6, 0.3, 0.1], [0.5, 0.3, 0.2])
    expected = 0.6 * math.log(1.2) + 0.1 * math.log(0.5)
    assert result == pytest.approx(expected)


def test_kl_divergence_for_empty_distributions():
    assert kl_divergence([], []) == pytest.approx(0.0)


def test_kl_divergence_is_unchanged_by_joint_permutation():
    original = kl_divergence([0.6, 0.3, 0.1], [0.5, 0.3, 0.2])
    permuted = kl_divergence([0.1, 0.6, 0.3], [0.2, 0.5, 0.3])
    assert permuted == pytest.approx(original)


def test_rlhf_objective_combines_reward_and_kl_penalty():
    policy = [0.7, 0.2, 0.1]
    reference = [0.6, 0.3, 0.1]
    rewards = [1.0, 0.5, 0.0]
    expected_reward = 0.8
    expected_kl = 0.7 * math.log(7 / 6) + 0.2 * math.log(2 / 3)
    assert rlhf_objective(policy, reference, rewards, 0.1) == pytest.approx(
        expected_reward - 0.1 * expected_kl
    )


def test_rlhf_objective_handles_empty_input():
    assert rlhf_objective([], [], [], 0.0) == pytest.approx(0.0)


def test_rlhf_objective_decreases_when_beta_grows():
    policy = [0.8, 0.2]
    reference = [0.5, 0.5]
    rewards = [-1.0, -2.0]
    weak_penalty = rlhf_objective(policy, reference, rewards, 0.01)
    strong_penalty = rlhf_objective(policy, reference, rewards, 0.1)
    assert strong_penalty < weak_penalty


def test_kl_anchored_policy_exploits_b_reward_bias():
    reference = [0.6, 0.3, 0.1]
    result = kl_anchored_policy(reference, [0.0, 0.5, 0.0], 0.1)
    weights = [0.6, 0.3 * math.exp(5), 0.1]
    expected = [weight / sum(weights) for weight in weights]
    assert result == pytest.approx(expected)


def test_kl_anchored_policy_handles_empty_input():
    assert kl_anchored_policy([], [], 0.1) == pytest.approx([])


def test_kl_anchored_policy_is_shift_invariant():
    reference = [0.6, 0.3, 0.1]
    original = kl_anchored_policy(reference, [0.0, 0.5, 0.0], 0.1)
    shifted = kl_anchored_policy(reference, [-10.0, -9.5, -10.0], 0.1)
    assert shifted == pytest.approx(original)


def test_alignment_tax_is_average_benchmark_drop():
    before = [0.8, 0.7, 0.6]
    after = [0.7, 0.65, 0.55]
    assert alignment_tax(before, after) == pytest.approx(1 / 15)


def test_alignment_tax_for_empty_benchmarks():
    assert alignment_tax([], []) == pytest.approx(0.0)


def test_alignment_tax_is_negative_for_improvement():
    before = [0.5, 0.6]
    after = [0.7, 0.8]
    assert alignment_tax(before, after) == pytest.approx(-0.2)


def test_ppo_ptx_objective_adds_pretraining_likelihood():
    probabilities = [1.0, math.exp(-2.0)]
    assert ppo_ptx_objective(2.0, probabilities, 0.5) == pytest.approx(1.5)


def test_ppo_ptx_objective_handles_empty_pretraining_batch():
    assert ppo_ptx_objective(-2.0, [], 0.5) == pytest.approx(-2.0)


def test_ppo_ptx_objective_with_zero_gamma_keeps_rlhf_score():
    assert ppo_ptx_objective(-3.0, [0.0, 0.5], 0.0) == pytest.approx(-3.0)


def test_ppo_ptx_objective_penalizes_zero_probability():
    result = ppo_ptx_objective(2.0, [1.0, 0.0], 0.5)
    assert result < 0
    assert math.isinf(result)
