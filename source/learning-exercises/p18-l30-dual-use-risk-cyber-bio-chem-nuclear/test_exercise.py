import pytest

from exercise import (
    uplifted_score,
    automated_campaign_percent,
    attempts_after_optimization,
    bottleneck_capability,
    asymmetry_metrics,
    triage_domains,
    risk_scope,
)


def test_uplifted_score_ordinary_case():
    assert uplifted_score(10, 2.53) == pytest.approx(25.3)


def test_uplifted_score_zero_and_negative_values():
    assert uplifted_score(0, 2.53) == pytest.approx(0)
    assert uplifted_score(10, 0) == pytest.approx(0)
    with pytest.raises(ValueError):
        uplifted_score(-1, 2.53)
    with pytest.raises(ValueError):
        uplifted_score(1, -2.53)


def test_uplifted_score_is_additive_over_baselines():
    combined = uplifted_score(4 + 6, 2.53)
    separate = uplifted_score(4, 2.53) + uplifted_score(6, 2.53)
    assert combined == pytest.approx(separate)


def test_automated_campaign_percent_ordinary_case():
    assert automated_campaign_percent(50, 5) == pytest.approx(90)


def test_automated_campaign_percent_boundaries():
    assert automated_campaign_percent(4, 0) == pytest.approx(100)
    assert automated_campaign_percent(6, 6) == pytest.approx(0)
    with pytest.raises(ValueError):
        automated_campaign_percent(0, 0)
    with pytest.raises(ValueError):
        automated_campaign_percent(10, -1)


def test_automated_campaign_percent_matches_lesson_range():
    assert automated_campaign_percent(40, 4) == pytest.approx(90)
    assert automated_campaign_percent(30, 6) == pytest.approx(80)


def test_automated_and_human_percentages_are_complements():
    total_steps = 40
    human_steps = 6
    automated = automated_campaign_percent(total_steps, human_steps)
    human = human_steps / total_steps * 100
    assert automated + human == pytest.approx(100)


def test_attempts_after_optimization_ordinary_case():
    assert attempts_after_optimization(158, 79) == pytest.approx(2)


def test_attempts_after_optimization_boundaries():
    assert attempts_after_optimization(0, 79) == pytest.approx(0)
    with pytest.raises(ValueError):
        attempts_after_optimization(-1, 79)
    with pytest.raises(ValueError):
        attempts_after_optimization(79, 0)


def test_attempts_after_optimization_matches_lesson_example():
    assert attempts_after_optimization(79, 79) == pytest.approx(1)


def test_attempts_after_optimization_scales_with_workload():
    first = attempts_after_optimization(79, 79)
    doubled = attempts_after_optimization(158, 79)
    assert doubled == pytest.approx(first * 2)


def test_bottleneck_capability_ordinary_case():
    assert bottleneck_capability(80, 30) == pytest.approx(30)


def test_bottleneck_capability_with_no_physical_access():
    assert bottleneck_capability(100, 0) == pytest.approx(0)
    assert bottleneck_capability(0, 100) == pytest.approx(0)
    with pytest.raises(ValueError):
        bottleneck_capability(100, -1)


def test_bottleneck_capability_is_symmetric():
    forward = bottleneck_capability(75, 20)
    reversed_order = bottleneck_capability(20, 75)
    assert forward == pytest.approx(reversed_order)


def test_bottleneck_never_exceeds_either_factor():
    result = bottleneck_capability(90, 25)
    assert result <= 90
    assert result <= 25


def test_asymmetry_metrics_ordinary_case():
    novice_multiplier, expert_gain = asymmetry_metrics(2, 5.06, 60, 75)
    assert novice_multiplier == pytest.approx(2.53)
    assert expert_gain == pytest.approx(15)


def test_asymmetry_metrics_unchanged_capabilities():
    novice_multiplier, expert_gain = asymmetry_metrics(1, 1, 0, 0)
    assert novice_multiplier == pytest.approx(1)
    assert expert_gain == pytest.approx(0)


def test_asymmetry_metrics_rejects_invalid_values():
    with pytest.raises(ValueError):
        asymmetry_metrics(0, 5, 60, 75)
    with pytest.raises(ValueError):
        asymmetry_metrics(-1, 5, 60, 75)
    with pytest.raises(ValueError):
        asymmetry_metrics(2, 1, 60, 75)


def test_novice_multiplier_is_scale_invariant():
    original = asymmetry_metrics(2, 5.06, 60, 75)[0]
    scaled = asymmetry_metrics(20, 50.6, 60, 75)[0]
    assert scaled == pytest.approx(original)


def test_triage_domains_ordinary_case():
    claim = "Биологический uplift и киберкампания требуют разных мер."
    assert triage_domains(claim) == ("bio", "cyber")


def test_triage_domains_empty_text():
    assert triage_domains("") == ()
    assert triage_domains("В заявлении нет подходящих ключевых слов.") == ()


def test_triage_domains_recognizes_all_lesson_domains():
    claim = "BIO, химический риск, CYBER и ядерный материал"
    assert triage_domains(claim) == ("bio", "chem", "cyber", "nuclear")


def test_triage_domains_ignores_case_order_and_duplicates():
    first = triage_domains("CYBER, био, cyber и БИОЛОГИЧЕСКИЙ риск")
    second = triage_domains("био и кибер")
    assert first == second == ("bio", "cyber")


def test_risk_scope_for_both_groups():
    assert risk_scope(True, True) == "both"


def test_risk_scope_for_neither_group():
    assert risk_scope(False, False) == "neither"


def test_risk_scope_for_each_single_group():
    assert risk_scope(True, False) == "novice-relative"
    assert risk_scope(False, True) == "expert-absolute"


def test_risk_scope_covers_truth_table():
    results = {
        risk_scope(False, False),
        risk_scope(True, False),
        risk_scope(False, True),
        risk_scope(True, True),
    }
    assert results == {"neither", "novice-relative", "expert-absolute", "both"}
