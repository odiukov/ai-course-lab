import pytest

from exercise import wmdp_total, accuracy_by_domain, chance_accuracy, relative_uplift, percentage_point_gain, unlearning_tradeoff, safety_case_ready


def test_wmdp_total_known_domain_counts():
    sizes = {"bio": 1520, "cyber": 2225, "chemistry": 412}
    assert wmdp_total(sizes) == 4157


def test_wmdp_total_empty():
    assert wmdp_total({}) == 0


def test_wmdp_total_is_independent_of_domain_order():
    first = {"bio": 1520, "cyber": 2225, "chemistry": 412}
    second = {"chemistry": 412, "bio": 1520, "cyber": 2225}
    assert wmdp_total(first) == wmdp_total(second)


def test_wmdp_total_rejects_negative_size():
    with pytest.raises(ValueError):
        wmdp_total({"bio": 1520, "cyber": -1})


def test_accuracy_by_domain_normal_case():
    records = [
        ("bio", "A", "A"),
        ("bio", "B", "C"),
        ("cyber", "D", "D"),
    ]
    result = accuracy_by_domain(records)
    assert result["bio"] == pytest.approx(0.5)
    assert result["cyber"] == pytest.approx(1.0)


def test_accuracy_by_domain_empty():
    assert accuracy_by_domain([]) == {}


def test_accuracy_by_domain_is_independent_of_record_order():
    records = [
        ("chemistry", "A", "B"),
        ("bio", "C", "C"),
        ("chemistry", "D", "D"),
    ]
    reversed_records = list(reversed(records))
    assert accuracy_by_domain(records) == pytest.approx(
        accuracy_by_domain(reversed_records)
    )


def test_chance_accuracy_for_four_options():
    assert chance_accuracy(4) == pytest.approx(0.25)


def test_chance_accuracy_for_one_option():
    assert chance_accuracy(1) == pytest.approx(1.0)


def test_chance_accuracy_rejects_nonpositive_counts():
    for count in (0, -4):
        with pytest.raises(ValueError):
            chance_accuracy(count)


def test_relative_uplift_matches_anthropic_example():
    assert relative_uplift(10, 25.3) == pytest.approx(2.53)


def test_relative_uplift_rejects_zero_baseline():
    with pytest.raises(ValueError):
        relative_uplift(0, 25.3)


def test_relative_uplift_is_scale_invariant():
    original = relative_uplift(10, 25.3)
    scaled = relative_uplift(100, 253)
    assert original == pytest.approx(scaled)


def test_percentage_point_gain_normal_case():
    assert percentage_point_gain(40, 60) == pytest.approx(20)


def test_percentage_point_gain_when_results_are_zero():
    assert percentage_point_gain(0, 0) == pytest.approx(0)


def test_percentage_point_gain_changes_sign_when_swapped():
    forward = percentage_point_gain(1, 4)
    backward = percentage_point_gain(4, 1)
    assert forward == pytest.approx(-backward)


def test_percentage_point_gain_rejects_negative_result():
    with pytest.raises(ValueError):
        percentage_point_gain(-1, 4)


def test_unlearning_tradeoff_separates_target_and_general_losses():
    result = unlearning_tradeoff(65, 25, 60, 58)
    assert result["target_drop"] == pytest.approx(40)
    assert result["general_drop"] == pytest.approx(2)


def test_unlearning_tradeoff_with_zero_scores():
    result = unlearning_tradeoff(0, 0, 0, 0)
    assert result["target_drop"] == pytest.approx(0)
    assert result["general_drop"] == pytest.approx(0)


def test_unlearning_tradeoff_reverses_when_before_and_after_are_swapped():
    forward = unlearning_tradeoff(65, 25, 60, 58)
    backward = unlearning_tradeoff(25, 65, 58, 60)
    assert forward["target_drop"] == pytest.approx(-backward["target_drop"])
    assert forward["general_drop"] == pytest.approx(-backward["general_drop"])


def test_safety_case_ready_with_all_evidence():
    assert safety_case_ready(True, True, True, True) is True


def test_safety_case_is_not_ready_from_wmdp_alone():
    assert safety_case_ready(True, False, False, False) is False


def test_safety_case_all_false_boundary():
    assert safety_case_ready(False, False, False, False) is False


def test_safety_case_requires_every_evidence_layer():
    for missing_index in range(4):
        evidence = [True, True, True, True]
        evidence[missing_index] = False
        assert safety_case_ready(*evidence) is False
