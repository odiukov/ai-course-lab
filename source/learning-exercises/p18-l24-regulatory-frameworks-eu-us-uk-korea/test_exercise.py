import pytest

from exercise import classify_eu_risk, eu_act_deadline, gpai_code_chapters, applicable_jurisdictions, korean_ai_obligations, institute_policy_shift


def test_classify_eu_risk_normal_case():
    assert classify_eu_risk("employment") == "high-risk"


def test_classify_eu_risk_empty_value():
    with pytest.raises(ValueError):
        classify_eu_risk("")


def test_classify_eu_risk_known_levels_from_lesson():
    assert classify_eu_risk("social_scoring") == "prohibited"
    assert classify_eu_risk("gpai_model") == "general-purpose"
    assert classify_eu_risk("weather_chatbot") == "limited-risk"


def test_classify_eu_risk_ignores_case_and_spaces():
    assert classify_eu_risk("  EDUCATION  ") == classify_eu_risk("education")


def test_eu_act_deadline_normal_case():
    assert eu_act_deadline("gpai") == "2025-08-02"


def test_eu_act_deadline_empty_value():
    with pytest.raises(ValueError):
        eu_act_deadline("")


def test_eu_act_deadline_known_article_50_date():
    assert eu_act_deadline("article_50") == "2026-08-02"
    assert eu_act_deadline("fines") == "2026-08-02"


def test_eu_act_deadline_ignores_case_and_spaces():
    assert eu_act_deadline("  GPAI  ") == eu_act_deadline("gpai")


def test_gpai_code_chapters_normal_provider():
    assert gpai_code_chapters(1e24) == ("Transparency", "Copyright")


def test_gpai_code_chapters_zero_and_negative_boundary():
    assert gpai_code_chapters(0) == ("Transparency", "Copyright")
    with pytest.raises(ValueError):
        gpai_code_chapters(-1)


def test_gpai_code_chapters_systemic_threshold_from_lesson():
    assert gpai_code_chapters(1e25) == (
        "Transparency",
        "Copyright",
        "Safety and Security",
    )


def test_gpai_systemic_chapters_include_regular_chapters():
    regular = set(gpai_code_chapters(1e24))
    systemic = set(gpai_code_chapters(1e26))
    assert regular < systemic


def test_applicable_jurisdictions_three_region_scenario():
    result = applicable_jurisdictions("US", "EU", ["Korea"])
    assert result == ("EU", "Korea", "US")


def test_applicable_jurisdictions_empty_inputs():
    assert applicable_jurisdictions("", "", []) == ()


def test_applicable_jurisdictions_user_order_does_not_matter():
    first = applicable_jurisdictions("US", "EU", ["Korea", "EU"])
    second = applicable_jurisdictions("US", "EU", ["EU", "Korea"])
    assert first == second


def test_applicable_jurisdictions_removes_duplicates():
    assert applicable_jurisdictions("US", "US", ["US"]) == ("US",)


def test_korean_ai_obligations_foreign_provider():
    assert korean_ai_obligations(True, False, False) == ("local_representative",)


def test_korean_ai_obligations_empty_boundary():
    assert korean_ai_obligations(False, False, False) == ()


def test_korean_ai_obligations_high_impact_system():
    assert korean_ai_obligations(False, True, False) == (
        "risk_assessment",
        "safety_measures",
    )


def test_korean_ai_obligations_do_not_duplicate_safety_measures():
    result = korean_ai_obligations(True, True, True)
    assert result == (
        "local_representative",
        "risk_assessment",
        "safety_measures",
    )
    assert result.count("safety_measures") == 1


def test_institute_policy_shift_uk():
    assert institute_policy_shift("UK") == (
        "AI Safety Institute",
        "AI Security Institute",
        "frontier security",
    )


def test_institute_policy_shift_empty_value():
    with pytest.raises(ValueError):
        institute_policy_shift("")


def test_institute_policy_shift_us_known_answer():
    assert institute_policy_shift("US") == (
        "AI Safety Institute",
        "CAISI",
        "standards and innovation",
    )


def test_institute_policy_shift_ignores_case_and_spaces():
    assert institute_policy_shift("  uk  ") == institute_policy_shift("UK")
