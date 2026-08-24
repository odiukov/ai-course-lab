import pytest

from exercise import (
    context_capacity,
    power_law_asr,
    fit_power_law,
    shared_pattern_gain,
    count_harmful_compliance,
    apply_pattern_defense,
    defense_impact,
)


def test_context_capacity_regular_case():
    assert context_capacity(200_000, 1_000) == 200


def test_context_capacity_zero_and_invalid_values():
    assert context_capacity(0, 1_000) == 0
    with pytest.raises(ValueError):
        context_capacity(-1, 1_000)
    with pytest.raises(ValueError):
        context_capacity(1_000, 0)


def test_context_capacity_grows_with_window():
    assert context_capacity(1_000_000, 1_000) == 1_000
    assert context_capacity(2_000_000, 1_000) == 2 * context_capacity(
        1_000_000, 1_000
    )


def test_power_law_asr_regular_case():
    assert power_law_asr(32, 0.01, 0.5) == pytest.approx(
        0.01 * 32**0.5
    )


def test_power_law_asr_nonpositive_shots_and_invalid_parameters():
    assert power_law_asr(0, 0.1, 0.5) == pytest.approx(0.0)
    assert power_law_asr(-5, 0.1, 0.5) == pytest.approx(0.0)
    with pytest.raises(ValueError):
        power_law_asr(5, -0.1, 0.5)


def test_power_law_asr_increases_and_is_capped():
    assert power_law_asr(256, 0.01, 0.5) > power_law_asr(
        5, 0.01, 0.5
    )
    assert power_law_asr(256, 0.1, 0.5) == pytest.approx(1.0)


def test_fit_power_law_recovers_known_exponent():
    shots = [5, 32, 128, 256, 512]
    asr = [0.02 * value**0.5 for value in shots]
    assert fit_power_law(shots, asr) == pytest.approx(0.5)


def test_fit_power_law_rejects_insufficient_data():
    with pytest.raises(ValueError):
        fit_power_law([], [])
    with pytest.raises(ValueError):
        fit_power_law([5], [0.1])
    with pytest.raises(ValueError):
        fit_power_law([5, 32], [0.1])


def test_fit_power_law_is_unchanged_by_point_order():
    shots = [5, 32, 128, 256]
    asr = [0.01 * value**0.75 for value in shots]
    assert fit_power_law(shots, asr) == pytest.approx(
        fit_power_law(list(reversed(shots)), list(reversed(asr)))
    )


def test_shared_pattern_gain_regular_case():
    assert shared_pattern_gain(32, 128, 0.5) == pytest.approx(2.0)


def test_shared_pattern_gain_identity_and_invalid_values():
    assert shared_pattern_gain(256, 256, 0.5) == pytest.approx(1.0)
    with pytest.raises(ValueError):
        shared_pattern_gain(0, 256, 0.5)
    with pytest.raises(ValueError):
        shared_pattern_gain(5, 256, -0.5)


def test_shared_pattern_gain_is_reciprocal():
    forward = shared_pattern_gain(5, 256, 0.5)
    backward = shared_pattern_gain(256, 5, 0.5)
    assert forward * backward == pytest.approx(1.0)


def test_count_harmful_compliance_regular_case():
    examples = [(True, True), (True, False), (False, True), (True, True)]
    assert count_harmful_compliance(examples) == 2


def test_count_harmful_compliance_empty_context():
    assert count_harmful_compliance([]) == 0


def test_count_harmful_compliance_ignores_order():
    examples = [(True, True), (False, False), (True, False), (True, True)]
    assert count_harmful_compliance(examples) == count_harmful_compliance(
        list(reversed(examples))
    )


def test_apply_pattern_defense_rewrites_detected_pattern():
    examples = [(True, True), (False, True), (True, True)]
    assert apply_pattern_defense(examples, 2) == [
        (True, False),
        (False, True),
        (True, False),
    ]


def test_apply_pattern_defense_empty_context_and_invalid_threshold():
    assert apply_pattern_defense([], 1) == []
    with pytest.raises(ValueError):
        apply_pattern_defense([], 0)
    with pytest.raises(ValueError):
        apply_pattern_defense([], -1)


def test_apply_pattern_defense_preserves_context_below_threshold():
    examples = [(True, True), (False, True), (True, False)]
    result = apply_pattern_defense(examples, 2)
    assert result == examples
    assert result is not examples


def test_defense_impact_uses_reported_numbers():
    assert defense_impact(100) == pytest.approx((61.0, 2.0, 59.0))


def test_defense_impact_zero_and_invalid_values():
    assert defense_impact(0) == pytest.approx((0.0, 0.0, 0.0))
    with pytest.raises(ValueError):
        defense_impact(-1)
    with pytest.raises(ValueError):
        defense_impact(100, 101, 2)


def test_defense_impact_scales_with_attempt_count():
    one_hundred = defense_impact(100)
    two_hundred = defense_impact(200)
    assert two_hundred == pytest.approx(
        tuple(2 * value for value in one_hundred)
    )
