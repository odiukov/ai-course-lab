import pytest

from exercise import has_all_pillars, scheming_signal, deception_persistence, reduction_factor, evaluation_confound, triage_incident


def test_has_all_pillars_with_multistep_plan():
    assert has_all_pillars(True, 2, True) is True


def test_has_all_pillars_rejects_nonpositive_plan_lengths():
    assert has_all_pillars(True, 0, True) is False
    assert has_all_pillars(True, -3, True) is False


def test_has_all_pillars_requires_each_pillar():
    assert has_all_pillars(False, 2, True) is False
    assert has_all_pillars(True, 1, True) is False
    assert has_all_pillars(True, 2, False) is False


def test_scheming_signal_detects_beneficial_error():
    assert scheming_signal(False, True, False) is True


def test_scheming_signal_is_false_without_signals():
    assert scheming_signal(False, False, False) is False


def test_scheming_signal_accepts_each_operational_definition():
    assert scheming_signal(True, False, False) is True
    assert scheming_signal(False, True, False) is True
    assert scheming_signal(False, False, True) is True


def test_deception_persistence_matches_seventeen_of_twenty():
    answers = [True] * 17 + [False] * 3
    assert deception_persistence(answers) == pytest.approx(0.85)


def test_deception_persistence_is_zero_for_empty_list():
    assert deception_persistence([]) == pytest.approx(0.0)


def test_deception_persistence_ignores_answer_order():
    answers = [True, False, True, True, False]
    assert deception_persistence(answers) == pytest.approx(
        deception_persistence(list(reversed(answers)))
    )


def test_reduction_factor_uses_lesson_numbers():
    assert reduction_factor(13.0, 0.4) == pytest.approx(32.5)
    assert reduction_factor(31.4, 14.2) == pytest.approx(31.4 / 14.2)


def test_reduction_factor_handles_zero_after():
    assert reduction_factor(13.0, 0.0) == float("inf")
    assert reduction_factor(0.0, 0.0) == float("inf")


def test_reduction_factor_is_scale_invariant():
    assert reduction_factor(13.0, 0.4) == pytest.approx(
        reduction_factor(130.0, 4.0)
    )


def test_reduction_factor_rejects_negative_rates():
    with pytest.raises(ValueError):
        reduction_factor(-13.0, 0.4)
    with pytest.raises(ValueError):
        reduction_factor(13.0, -0.4)


def test_evaluation_confound_detects_evaluation_only_improvement():
    assert evaluation_confound(13.0, 0.4, 13.0, 13.0) == pytest.approx(12.6)


def test_evaluation_confound_is_zero_without_changes():
    assert evaluation_confound(0.0, 0.0, 0.0, 0.0) == pytest.approx(0.0)


def test_evaluation_confound_is_zero_for_equal_improvements():
    assert evaluation_confound(13.0, 0.4, 14.0, 1.4) == pytest.approx(0.0)


def test_evaluation_confound_rejects_negative_rates():
    with pytest.raises(ValueError):
        evaluation_confound(-1.0, 0.0, 0.0, 0.0)


def test_triage_incident_identifies_scheming():
    assert triage_incident(True, True, True, False) == "scheming"


def test_triage_incident_defaults_to_capability():
    assert triage_incident(False, False, False, False) == "capability"


def test_triage_incident_identifies_control_failure():
    assert triage_incident(True, True, False, True) == "control"


def test_triage_incident_requires_every_pillar_for_scheming():
    pillar_sets = [
        (False, True, True),
        (True, False, True),
        (True, True, False),
    ]
    for pillars in pillar_sets:
        assert triage_incident(*pillars, False) == "capability"
