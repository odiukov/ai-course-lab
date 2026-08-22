import pytest

from exercise import (
    collapse_openai_category,
    supports_image_moderation,
    perspective_action,
    parallel_layer_latency,
    first_triggered_layer,
    azure_migration_window_months,
)


def test_collapse_openai_subcategory():
    assert collapse_openai_category("self-harm/instructions") == "self-harm"
    assert collapse_openai_category("violence/graphic") == "violence"


def test_collapse_openai_empty_category():
    with pytest.raises(ValueError):
        collapse_openai_category("")


def test_collapse_produces_six_parent_categories():
    categories = [
        "harassment",
        "harassment/threatening",
        "hate",
        "hate/threatening",
        "illicit",
        "illicit/violent",
        "self-harm",
        "self-harm/intent",
        "self-harm/instructions",
        "sexual",
        "sexual/minors",
        "violence",
        "violence/graphic",
    ]
    parents = {collapse_openai_category(category) for category in categories}
    assert parents == {
        "harassment",
        "hate",
        "illicit",
        "self-harm",
        "sexual",
        "violence",
    }


def test_image_moderation_supported_categories():
    assert supports_image_moderation("violence") is True
    assert supports_image_moderation("sexual/minors") is False


def test_image_moderation_rejects_empty_category():
    with pytest.raises(ValueError):
        supports_image_moderation("")


def test_exactly_three_categories_support_images():
    categories = [
        "harassment",
        "hate",
        "illicit",
        "self-harm",
        "sexual",
        "sexual/minors",
        "violence",
    ]
    supported = {
        category
        for category in categories
        if supports_image_moderation(category)
    }
    assert supported == {"violence", "self-harm", "sexual"}


def test_perspective_hides_score_at_threshold():
    assert perspective_action(0.85, 0.80) == "hide"
    assert perspective_action(0.40, 0.80) == "show"


def test_perspective_accepts_zero_boundary():
    assert perspective_action(0, 0) == "hide"


def test_perspective_rejects_negative_score():
    with pytest.raises(ValueError):
        perspective_action(-0.1, 0.5)


def test_perspective_action_is_monotonic_above_threshold():
    assert perspective_action(0.6, 0.5) == "hide"
    assert perspective_action(0.9, 0.5) == "hide"


def test_parallel_latency_is_slowest_classifier():
    assert parallel_layer_latency([90, 120, 60]) == 120


def test_parallel_latency_of_empty_layer_is_zero():
    assert parallel_layer_latency([]) == 0


def test_parallel_latency_rejects_negative_value():
    with pytest.raises(ValueError):
        parallel_layer_latency([90, -1, 60])


def test_parallel_latency_is_permutation_invariant():
    assert parallel_layer_latency([60, 120, 90]) == parallel_layer_latency(
        [90, 60, 120]
    )


def test_output_layer_triggers_after_earlier_layers_pass():
    assert first_triggered_layer(False, False, True) == "output"


def test_no_trigger_allows_content():
    assert first_triggered_layer(False, False, False) == "allow"


def test_input_layer_has_priority_over_all_other_layers():
    assert first_triggered_layer(True, True, True) == "input"


def test_custom_layer_precedes_output_layer():
    assert first_triggered_layer(False, True, True) == "custom"


def test_azure_window_matches_lesson_dates():
    assert azure_migration_window_months(2024, 2, 2027, 2) == 36


def test_azure_window_can_be_zero():
    assert azure_migration_window_months(2024, 2, 2024, 2) == 0


def test_azure_window_rejects_reversed_dates():
    with pytest.raises(ValueError):
        azure_migration_window_months(2027, 2, 2024, 2)


def test_azure_window_is_unchanged_when_both_years_shift():
    original = azure_migration_window_months(2024, 2, 2027, 2)
    shifted = azure_migration_window_months(2025, 2, 2028, 2)
    assert shifted == original
