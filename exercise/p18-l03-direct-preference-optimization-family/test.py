import math

import pytest

from exercise import (
    implicit_reward_gap,
    dpo_loss,
    ipo_loss,
    kto_loss,
    simpo_loss,
    orpo_loss,
    bpo_loss,
)


def test_implicit_reward_gap_regular_case():
    result = implicit_reward_gap(0.5, -20.0, -22.0, -25.0, -24.0)
    assert result == pytest.approx(1.5)


def test_implicit_reward_gap_zero_beta():
    result = implicit_reward_gap(0.0, -20.0, -22.0, -25.0, -24.0)
    assert result == pytest.approx(0.0)


def test_implicit_reward_gap_changes_sign_when_answers_are_swapped():
    forward = implicit_reward_gap(0.1, -20.0, -21.0, -25.0, -23.0)
    backward = implicit_reward_gap(0.1, -25.0, -23.0, -20.0, -21.0)
    assert backward == pytest.approx(-forward)


def test_dpo_loss_regular_case():
    result = dpo_loss(0.1, 5.0, 0.0)
    assert result == pytest.approx(math.log1p(math.exp(-0.5)))


def test_dpo_loss_zero_beta():
    assert dpo_loss(0.0, -20.0, 100.0) == pytest.approx(math.log(2.0))


def test_dpo_loss_swap_identity():
    forward = dpo_loss(0.5, 4.0, 0.0)
    backward = dpo_loss(0.5, 0.0, 4.0)
    assert forward - backward == pytest.approx(-2.0)


def test_ipo_loss_reaches_target_from_lesson():
    assert ipo_loss(0.1, 5.0, 0.0) == pytest.approx(0.0)


def test_ipo_loss_rejects_zero_beta():
    with pytest.raises(ValueError):
        ipo_loss(0.0, 1.0, 0.0)


def test_ipo_loss_is_symmetric_around_target():
    below = ipo_loss(0.5, -1.0, 0.0)
    above = ipo_loss(0.5, 3.0, 0.0)
    assert below == pytest.approx(above)


def test_kto_loss_for_desirable_answer():
    result = kto_loss(1.0, 2.0, True)
    assert result == pytest.approx(1.0 / (1.0 + math.exp(2.0)))


def test_kto_loss_at_zero_with_loss_aversion():
    assert kto_loss(1.0, 0.0, False, loss_aversion=2.0) == pytest.approx(1.0)


def test_kto_loss_label_and_score_symmetry():
    desirable = kto_loss(1.0, 3.0, True)
    undesirable = kto_loss(1.0, -3.0, False)
    assert desirable == pytest.approx(undesirable)


def test_kto_loss_rejects_negative_loss_aversion():
    with pytest.raises(ValueError):
        kto_loss(1.0, 0.0, False, loss_aversion=-1.0)


def test_simpo_loss_uses_length_normalized_numbers_from_lesson():
    result = simpo_loss(1.0, -10.0, 20, -36.0, 60)
    assert result == pytest.approx(math.log1p(math.exp(-0.1)))


def test_simpo_loss_rejects_zero_length():
    with pytest.raises(ValueError):
        simpo_loss(1.0, -10.0, 0, -36.0, 60)


def test_simpo_loss_is_invariant_to_proportional_length_scaling():
    original = simpo_loss(1.0, -10.0, 20, -36.0, 60)
    doubled = simpo_loss(1.0, -20.0, 40, -72.0, 120)
    assert doubled == pytest.approx(original)


def test_orpo_loss_with_probabilities_from_lesson():
    result = orpo_loss(0.8, 0.5)
    expected = -math.log(0.8) + math.log(1.25)
    assert result == pytest.approx(expected)


@pytest.mark.parametrize(
    ("chosen", "rejected"),
    [(0.0, 0.5), (-0.1, 0.5), (0.8, 1.0)],
)
def test_orpo_loss_rejects_invalid_probabilities(chosen, rejected):
    with pytest.raises(ValueError):
        orpo_loss(chosen, rejected)


def test_orpo_loss_without_preference_term_equals_nll():
    result = orpo_loss(0.8, 0.5, preference_weight=0.0)
    assert result == pytest.approx(-math.log(0.8))


def test_orpo_loss_for_equal_probabilities_has_neutral_preference_loss():
    result = orpo_loss(0.5, 0.5)
    assert result == pytest.approx(-math.log(0.5) + math.log(2.0))


def test_bpo_loss_penalizes_degraded_chosen_response():
    base = dpo_loss(0.1, 5.0, 0.0)
    result = bpo_loss(0.1, 5.0, 0.0, -20.0, -22.0)
    assert result == pytest.approx(base + 2.0)


def test_bpo_loss_adds_no_penalty_when_chosen_improves():
    base = dpo_loss(0.1, 5.0, 0.0)
    result = bpo_loss(0.1, 5.0, 0.0, -20.0, -18.0)
    assert result == pytest.approx(base)


def test_bpo_loss_with_zero_preservation_weight_matches_dpo():
    base = dpo_loss(0.1, -3.0, 2.0)
    result = bpo_loss(
        0.1,
        -3.0,
        2.0,
        -20.0,
        -22.0,
        preservation_weight=0.0,
    )
    assert result == pytest.approx(base)


def test_bpo_loss_rejects_negative_preservation_weight():
    with pytest.raises(ValueError):
        bpo_loss(0.1, 5.0, 0.0, -20.0, -22.0, preservation_weight=-1.0)
