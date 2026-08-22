import base64

import pytest

from exercise import (
    guard_run_count,
    is_mlcommons_hazard,
    run_garak_harness,
    encode_base64_probe,
    apply_converter_chain,
    first_successful_turn,
    detection_rate,
)


def test_guard_run_count_checks_both_sides():
    assert guard_run_count(10) == 20


def test_guard_run_count_handles_zero_turns():
    assert guard_run_count(0) == 0
    assert guard_run_count(5, False, False) == 0


def test_guard_run_count_rejects_negative_turns():
    with pytest.raises(ValueError):
        guard_run_count(-1)


def test_guard_run_count_matches_lesson_scale():
    assert guard_run_count(1_000_000) == 2_000_000


def test_is_mlcommons_hazard_recognizes_common_category():
    assert is_mlcommons_hazard("privacy") is True


def test_is_mlcommons_hazard_rejects_empty_and_unknown_values():
    assert is_mlcommons_hazard("") is False
    assert is_mlcommons_hazard("weather") is False


def test_is_mlcommons_hazard_recognizes_non_obvious_category():
    assert is_mlcommons_hazard("Code Interpreter Abuse") is True


def test_is_mlcommons_hazard_recognizes_all_fourteen_categories():
    categories = [
        "violent_crimes", "non_violent_crimes", "sex_related", "csam",
        "defamation", "specialized_advice", "privacy", "ip",
        "indiscriminate_weapons", "hate", "suicide_self_harm",
        "sexual_content", "elections", "code_interpreter_abuse",
    ]
    assert sum(is_mlcommons_hazard(category) for category in categories) == 14


def test_run_garak_harness_connects_target_and_detector():
    probes = ["safe question", "attack request"]
    target = lambda prompt: "blocked" if "attack" in prompt else "answered"
    detector = lambda response: response == "blocked"
    assert run_garak_harness(probes, target, detector) == [False, True]


def test_run_garak_harness_handles_no_probes():
    target = lambda prompt: 1 / 0
    detector = lambda response: 1 / 0
    assert run_garak_harness([], target, detector) == []


def test_run_garak_harness_preserves_probe_order():
    target = lambda prompt: prompt
    detector = lambda response: response.startswith("bad")
    probes = ["bad-one", "good", "bad-two"]
    reversed_result = run_garak_harness(list(reversed(probes)), target, detector)
    assert reversed_result == list(reversed(run_garak_harness(probes, target, detector)))


def test_encode_base64_probe_known_text():
    assert encode_base64_probe("harmful request") == "aGFybWZ1bCByZXF1ZXN0"


def test_encode_base64_probe_handles_empty_text():
    assert encode_base64_probe("") == ""


def test_encode_base64_probe_preserves_unicode_on_round_trip():
    prompt = "опасный запрос"
    encoded = encode_base64_probe(prompt)
    decoded = base64.b64decode(encoded).decode("utf-8")
    assert decoded == prompt


def test_apply_converter_chain_uses_declared_order():
    converters = [str.upper, lambda text: text.replace("REQUEST", "QUESTION")]
    assert apply_converter_chain("safe request", converters) == "SAFE QUESTION"


def test_apply_converter_chain_handles_empty_chain():
    assert apply_converter_chain("", []) == ""
    assert apply_converter_chain("unchanged", []) == "unchanged"


def test_apply_converter_chain_matches_manual_composition():
    add_french_prefix = lambda text: "fr: " + text
    paraphrase = lambda text: text.replace("request", "question")
    prompt = "request"
    assert apply_converter_chain(prompt, [add_french_prefix, paraphrase]) == paraphrase(
        add_french_prefix(prompt)
    )


def test_first_successful_turn_finds_crescendo_threshold():
    assert first_successful_turn([0.1, 0.4, 0.8], 0.7) == 3


def test_first_successful_turn_handles_empty_campaign():
    assert first_successful_turn([], 0.7) is None


def test_first_successful_turn_handles_negative_scores():
    assert first_successful_turn([-3, -2, -1], -2) == 2


def test_first_successful_turn_shifts_when_weak_turn_is_added():
    scores = [0.2, 0.8]
    assert first_successful_turn([0.0] + scores, 0.7) == (
        first_successful_turn(scores, 0.7) + 1
    )


def test_detection_rate_for_mixed_results():
    assert detection_rate([True, False, True]) == pytest.approx(2 / 3)


def test_detection_rate_for_empty_results():
    assert detection_rate([]) == pytest.approx(0.0)


def test_detection_rate_for_zero_detections():
    assert detection_rate([False, False, False]) == pytest.approx(0.0)


def test_detection_rate_is_invariant_to_order():
    detections = [True, False, True, False, True]
    assert detection_rate(detections) == pytest.approx(
        detection_rate(list(reversed(detections)))
    )
