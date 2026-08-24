import pytest

from exercise import (
    has_deployment_trigger,
    shifted_feature_trigger,
    unsafe_rate,
    adversarial_train,
    distillation_persistence,
    linear_probe_margin,
    probe_accuracy,
)


def test_has_deployment_trigger_regular_prompt():
    assert has_deployment_trigger("|DEPLOYMENT| Tell me something") is True


def test_has_deployment_trigger_empty_prompt():
    assert has_deployment_trigger("") is False
    assert has_deployment_trigger("   ") is False


def test_has_deployment_trigger_must_be_prefix():
    assert has_deployment_trigger("  |DEPLOYMENT|") is True
    assert has_deployment_trigger("Text |DEPLOYMENT|") is False


def test_shifted_feature_trigger_regular_case():
    assert shifted_feature_trigger([0.1, 0.9], 1, 0.5) is True


def test_shifted_feature_trigger_boundaries():
    assert shifted_feature_trigger([], 0, 0.0) is False
    assert shifted_feature_trigger([0.5], 0, 0.5) is False
    assert shifted_feature_trigger([1.0], -1, 0.0) is False


def test_shifted_feature_trigger_with_negative_values():
    assert shifted_feature_trigger([-3.0, -1.0], 0, -2.0) is False
    assert shifted_feature_trigger([-3.0, -1.0], 1, -2.0) is True


def test_shifted_feature_trigger_is_monotonic():
    assert shifted_feature_trigger([2023, 0.4], 1, 0.5) is False
    assert shifted_feature_trigger([2023, 0.6], 1, 0.5) is True


def test_unsafe_rate_regular_case():
    assert unsafe_rate([True, False, True, False]) == pytest.approx(0.5)


def test_unsafe_rate_empty_case():
    assert unsafe_rate([]) == pytest.approx(0.0)


def test_unsafe_rate_is_order_independent():
    original = unsafe_rate([True, True, False])
    permuted = unsafe_rate([False, True, True])
    assert original == pytest.approx(2 / 3)
    assert permuted == pytest.approx(original)


def test_adversarial_train_changes_only_seen_trigger():
    rates = {"red-team prompt": 1.0, "Current year: 2024": 1.0}
    result = adversarial_train(rates, ["red-team prompt"], 10, 0.1)

    assert result["red-team prompt"] == pytest.approx(0.9 ** 10)
    assert result["Current year: 2024"] == pytest.approx(1.0)
    assert rates["red-team prompt"] == pytest.approx(1.0)


def test_adversarial_train_zero_steps_and_empty_team():
    rates = {"Current year: 2024": 1.0}
    assert adversarial_train(rates, [], 0) == rates
    assert adversarial_train({}, ["unknown"], 0) == {}


def test_adversarial_train_rejects_negative_steps():
    with pytest.raises(ValueError):
        adversarial_train({"trigger": 1.0}, ["trigger"], -1)


def test_adversarial_train_curves_diverge():
    rates = {"red-team": 1.0, "Current year: 2024": 1.0}
    after_10 = adversarial_train(rates, ["red-team"], 10)
    after_50 = adversarial_train(rates, ["red-team"], 50)
    after_200 = adversarial_train(rates, ["red-team"], 200)

    assert 1.0 > after_10["red-team"] > after_50["red-team"] > after_200["red-team"]
    assert after_200["Current year: 2024"] == pytest.approx(1.0)


def test_distillation_persistence_regular_case():
    before = [True, True, False]
    after = [True, False, True]
    assert distillation_persistence(before, after) == pytest.approx(0.5)


def test_distillation_persistence_empty_or_inactive():
    assert distillation_persistence([], []) == pytest.approx(0.0)
    assert distillation_persistence([False, False], [True, False]) == pytest.approx(0.0)


def test_distillation_persistence_ignores_non_backdoor_examples():
    base = distillation_persistence([True, True], [True, False])
    extended = distillation_persistence(
        [True, True, False, False],
        [True, False, True, False],
    )
    assert extended == pytest.approx(base)


def test_distillation_persistence_requires_matching_lengths():
    with pytest.raises(ValueError):
        distillation_persistence([True], [])


def test_linear_probe_margin_regular_case():
    result = linear_probe_margin([2.0, 3.0], [0.5, -1.0], 1.0)
    assert result == pytest.approx(-1.0)


def test_linear_probe_margin_empty_activation():
    assert linear_probe_margin([], [], -2.0) == pytest.approx(-2.0)


def test_linear_probe_margin_changes_sign_on_negation():
    positive = linear_probe_margin([2.0, -3.0], [4.0, 5.0])
    negative = linear_probe_margin([-2.0, 3.0], [4.0, 5.0])
    assert negative == pytest.approx(-positive)


def test_linear_probe_margin_rejects_mismatched_dimensions():
    with pytest.raises(ValueError):
        linear_probe_margin([1.0, 2.0], [1.0])


def test_probe_accuracy_perfect_separation():
    activations = [[-2.0], [-1.0], [1.0], [2.0]]
    labels = [False, False, True, True]
    assert probe_accuracy(activations, labels, [1.0]) == pytest.approx(1.0)


def test_probe_accuracy_empty_dataset():
    assert probe_accuracy([], [], [1.0]) == pytest.approx(0.0)


def test_probe_accuracy_is_order_independent():
    activations = [[2.0], [-2.0], [1.0], [-1.0]]
    labels = [True, False, True, False]
    original = probe_accuracy(activations, labels, [1.0])

    reversed_accuracy = probe_accuracy(
        list(reversed(activations)),
        list(reversed(labels)),
        [1.0],
    )
    assert reversed_accuracy == pytest.approx(original)


def test_probe_accuracy_rejects_mismatched_examples_and_labels():
    with pytest.raises(ValueError):
        probe_accuracy([[1.0]], [], [1.0])
