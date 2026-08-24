from exercise import is_tracked_capability, anthropic_asl, needs_affirmative_safety_case, deepmind_ccl_domains, threshold_term, safety_case_pillars, competitor_adjustment_triggered


def test_tracked_capability_all_five_criteria_pass():
    assert is_tracked_capability([True, True, True, True, True]) is True


def test_tracked_capability_empty_list():
    assert is_tracked_capability([]) is False


def test_tracked_capability_requires_every_criterion():
    criteria = [True, False, True, True, True]
    assert is_tracked_capability(criteria) is False
    assert is_tracked_capability(list(reversed(criteria))) is False


def test_anthropic_asl_for_cbrn_frontier_model():
    assert anthropic_asl(True, True, False, False) == "ASL-3"


def test_anthropic_asl_for_non_frontier_model():
    assert anthropic_asl(False, False, False, False) == "ASL-1"


def test_anthropic_asl_baseline():
    assert anthropic_asl(True, False, False, False) == "ASL-2"


def test_anthropic_asl_higher_level_has_priority():
    assert anthropic_asl(True, True, True, True) == "ASL-5+"
    assert anthropic_asl(True, True, True, False) == "ASL-4"


def test_safety_case_required_at_ai_rd_4():
    assert needs_affirmative_safety_case(4) is True


def test_safety_case_not_required_for_negative_level():
    assert needs_affirmative_safety_case(-1) is False


def test_safety_case_requirement_is_monotonic():
    assert needs_affirmative_safety_case(2) is False
    assert needs_affirmative_safety_case(5) is True


def test_deepmind_version_2_has_three_domains():
    assert deepmind_ccl_domains(2) == (
        "Bioweapon Uplift",
        "Cyber Uplift",
        "ML R&D Acceleration",
    )


def test_deepmind_nonexistent_early_version_is_empty():
    assert deepmind_ccl_domains(0) == ()


def test_deepmind_version_3_extends_version_2():
    version_2 = deepmind_ccl_domains(2)
    version_3 = deepmind_ccl_domains(3)
    assert version_3[:3] == version_2
    assert version_3[-1] == "Harmful Manipulation"


def test_threshold_term_for_openai():
    assert threshold_term("OpenAI") == "High Capability thresholds"


def test_threshold_term_for_empty_name():
    assert threshold_term("") == ""


def test_threshold_terms_are_distinct_and_normalized():
    terms = {
        threshold_term("  ANTHROPIC "),
        threshold_term("openai"),
        threshold_term("DeepMind"),
    }
    assert terms == {
        "Capability Thresholds",
        "High Capability thresholds",
        "Critical Capability Levels",
    }


def test_safety_case_pillars_for_deceptive_alignment():
    assert safety_case_pillars("deceptive_alignment") == (
        "monitoring",
        "illegibility",
    )


def test_safety_case_pillars_for_empty_risk():
    assert safety_case_pillars("") == ()


def test_cyber_uplift_uses_all_three_pillars():
    cyber = set(safety_case_pillars("cyber_uplift"))
    cbrn = set(safety_case_pillars("cbrn"))
    deceptive = set(safety_case_pillars("deceptive_alignment"))
    assert cyber == cbrn | deceptive
    assert len(cyber) == 3


def test_adjustment_triggered_by_one_unprotected_release():
    assert competitor_adjustment_triggered([False, True, False]) is True


def test_adjustment_not_triggered_by_empty_list():
    assert competitor_adjustment_triggered([]) is False


def test_adjustment_trigger_is_permutation_invariant():
    releases = [True, False, False]
    assert competitor_adjustment_triggered(releases) is True
    assert competitor_adjustment_triggered(list(reversed(releases))) is True
