import math

import pytest

from exercise import (
    biased_green_probability,
    watermark_z_score,
    false_positive_rate,
    affected_token_count,
    meets_stable_signature_claim,
    c2pa_status,
    provenance_evidence,
)


def test_biased_probability_known_logit_shift():
    result = biased_green_probability(0.5, math.log(2))
    assert result == pytest.approx(2 / 3)


def test_biased_probability_boundaries():
    assert biased_green_probability(0, 10) == pytest.approx(0)
    assert biased_green_probability(1, -10) == pytest.approx(1)
    with pytest.raises(ValueError):
        biased_green_probability(-0.1, 1)


def test_zero_bias_preserves_green_fraction():
    for fraction in (0.1, 0.5, 0.9):
        assert biased_green_probability(fraction, 0) == pytest.approx(fraction)


def test_positive_bias_increases_probability():
    original = biased_green_probability(0.5, 0)
    assert biased_green_probability(0.5, 1) > original
    assert biased_green_probability(0.5, -1) < original


def test_watermark_z_score_from_lesson():
    assert watermark_z_score(620, 1000) == pytest.approx(7.5894663844)


def test_watermark_z_score_empty_text():
    assert watermark_z_score(0, 0) == pytest.approx(0)


def test_watermark_z_score_rejects_invalid_counts():
    with pytest.raises(ValueError):
        watermark_z_score(-1, 1000)
    with pytest.raises(ValueError):
        watermark_z_score(1001, 1000)


def test_watermark_z_score_is_symmetric_around_expectation():
    positive = watermark_z_score(620, 1000)
    negative = watermark_z_score(380, 1000)
    assert positive == pytest.approx(-negative)
    assert watermark_z_score(500, 1000) == pytest.approx(0)


def test_false_positive_rate_at_95_percent_threshold():
    scores = [0.1, 1.7, -0.4, 2.2]
    assert false_positive_rate(scores, 1.645) == pytest.approx(0.5)


def test_false_positive_rate_empty_scores():
    assert false_positive_rate([], 1.645) == pytest.approx(0)


def test_false_positive_rate_ignores_score_order():
    scores = [-2.0, 0.0, 1.645, 3.0]
    forward = false_positive_rate(scores, 1.645)
    backward = false_positive_rate(list(reversed(scores)), 1.645)
    assert forward == pytest.approx(backward)
    assert forward == pytest.approx(0.5)


def test_single_change_affects_context():
    assert affected_token_count(10, [2], 3) == 4


def test_thirty_percent_replacement_can_affect_more_than_thirty_percent():
    assert affected_token_count(10, [0, 4, 8], 1) == 6


def test_no_changes_affect_nothing():
    assert affected_token_count(0, [], 0) == 0
    assert affected_token_count(1000, [], 4) == 0


def test_affected_positions_reject_invalid_input_and_ignore_order():
    assert affected_token_count(10, [4, 2, 4], 2) == affected_token_count(
        10, [2, 4], 2
    )
    with pytest.raises(ValueError):
        affected_token_count(-1, [], 2)
    with pytest.raises(ValueError):
        affected_token_count(10, [-1], 2)


def test_stable_signature_claim_matches_lesson_numbers():
    assert meets_stable_signature_claim(0.91, 0.9e-6) is True


def test_stable_signature_claim_uses_strict_boundaries():
    assert meets_stable_signature_claim(0.90, 0.9e-6) is False
    assert meets_stable_signature_claim(0.91, 1e-6) is False


def test_stable_signature_claim_rejects_invalid_rates():
    with pytest.raises(ValueError):
        meets_stable_signature_claim(-0.1, 0)
    with pytest.raises(ValueError):
        meets_stable_signature_claim(0.95, 1.1)


def test_c2pa_verified_manifest():
    assert c2pa_status(True, True) == "verified"


def test_c2pa_missing_is_different_from_invalid():
    assert c2pa_status(False, False) == "missing"
    assert c2pa_status(True, False) == "invalid"


def test_c2pa_removed_manifest_has_missing_status():
    assert c2pa_status(False, True) == "missing"
    with pytest.raises(TypeError):
        c2pa_status(1, True)


def test_provenance_sources_can_corroborate_each_other():
    assert provenance_evidence(True, "verified") == "corroborated"


def test_each_provenance_source_can_survive_alone():
    assert provenance_evidence(True, "missing") == "watermark_only"
    assert provenance_evidence(False, "verified") == "c2pa_only"


def test_absence_of_signals_is_not_proof_of_authenticity():
    assert provenance_evidence(False, "missing") == "no_provenance_evidence"
    assert provenance_evidence(False, "invalid") == "c2pa_invalid"
    assert provenance_evidence(True, "invalid") == "watermark_only_c2pa_invalid"
    with pytest.raises(ValueError):
        provenance_evidence(False, "unknown")
