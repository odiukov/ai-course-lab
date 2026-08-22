import pytest

from exercise import (
    missing_ab2013_fields,
    opt_outs_respected,
    choose_legal_basis,
    deletion_response,
    estimate_remaining_open_sources,
    c2pa_chain_matches,
)


AB2013_FIELDS = [
    "sources_or_owners",
    "purpose_fit",
    "data_point_count",
    "data_point_types",
    "intellectual_property_status",
    "purchased_or_licensed",
    "personal_data",
    "aggregated_consumer_data",
    "developer_modifications",
    "collection_period",
    "first_use_dates",
    "synthetic_data_use",
]


def test_missing_ab2013_fields_complete_summary():
    summary = {field: "описано" for field in AB2013_FIELDS}
    summary["data_point_count"] = 0
    summary["personal_data"] = False
    summary["aggregated_consumer_data"] = False
    summary["synthetic_data_use"] = False
    assert missing_ab2013_fields(summary) == []


def test_missing_ab2013_fields_empty_summary_has_all_12_fields():
    assert missing_ab2013_fields({}) == AB2013_FIELDS
    assert len(missing_ab2013_fields({})) == 12


def test_missing_ab2013_fields_detects_none_and_empty_string():
    summary = {field: "описано" for field in reversed(AB2013_FIELDS)}
    summary["sources_or_owners"] = ""
    summary["personal_data"] = None
    summary["extra_field"] = ""
    assert missing_ab2013_fields(summary) == [
        "sources_or_owners",
        "personal_data",
    ]


def test_opt_outs_respected_for_all_known_formats():
    signals = {
        "publisher.example": "robots.txt",
        "photo.example": "C2PA:No AI Training",
        "archive.example": "TDM.Reservation",
    }
    excluded = ["archive.example", "publisher.example", "photo.example"]
    assert opt_outs_respected(signals, excluded) is True


def test_opt_outs_respected_for_empty_inputs():
    assert opt_outs_respected({}, []) is True


def test_opt_outs_respected_detects_missing_exclusion():
    signals = {"publisher.example": "TDM.Reservation"}
    assert opt_outs_respected(signals, []) is False


def test_opt_outs_respected_ignores_order_duplicates_and_unknown_signals():
    signals = {
        "unknown.example": "email-request",
        "blocked.example": "robots.txt",
    }
    assert opt_outs_respected(
        signals,
        ["blocked.example", "blocked.example"],
    ) is True


def test_choose_legal_basis_accepts_lesson_scenario():
    result = choose_legal_basis(True, True, True, True, False)
    assert result == "legitimate_interest"


def test_choose_legal_basis_rejects_scenario_without_safeguards():
    result = choose_legal_basis(False, False, False, False, False)
    assert result == "consent"


def test_choose_legal_basis_requires_every_safeguard():
    scenarios = [
        (False, True, True, True, False),
        (True, False, True, True, False),
        (True, True, False, True, False),
        (True, True, True, False, False),
        (True, True, True, True, True),
    ]
    for scenario in scenarios:
        assert choose_legal_basis(*scenario) == "consent"


def test_deletion_response_before_collection():
    assert deletion_response(
        "before_collection",
        False,
    ) == "exclude_before_collection"


def test_deletion_response_removes_untrained_dataset_entry():
    assert deletion_response("in_dataset", False) == "remove_from_dataset"


def test_deletion_response_reflects_trained_model_irreversibility():
    assert deletion_response("trained", False) == "no_complete_removal"
    assert deletion_response("trained", True) == "retrain_from_scratch"


def test_deletion_response_rejects_empty_stage():
    with pytest.raises(ValueError):
        deletion_response("", False)


def test_estimate_remaining_open_sources_uses_lesson_percentage():
    assert estimate_remaining_open_sources(100) == pytest.approx(75)


def test_estimate_remaining_open_sources_handles_zero():
    assert estimate_remaining_open_sources(0, 25) == pytest.approx(0)


def test_estimate_remaining_open_sources_can_return_fraction():
    assert estimate_remaining_open_sources(3, 25) == pytest.approx(2.25)


def test_estimate_remaining_open_sources_rejects_invalid_values():
    with pytest.raises(ValueError):
        estimate_remaining_open_sources(-1, 25)
    with pytest.raises(ValueError):
        estimate_remaining_open_sources(100, -1)
    with pytest.raises(ValueError):
        estimate_remaining_open_sources(100, 101)


def test_c2pa_chain_matches_valid_chain():
    assert c2pa_chain_matches(
        "dataset-12",
        "dataset-12",
        "digest-25",
        "digest-25",
        True,
    ) is True


def test_c2pa_chain_matches_rejects_empty_values():
    assert c2pa_chain_matches("", "", "", "", True) is False


def test_c2pa_chain_matches_rejects_invalid_signature_or_digest():
    assert c2pa_chain_matches(
        "dataset-12",
        "dataset-12",
        "digest-25",
        "different",
        True,
    ) is False
    assert c2pa_chain_matches(
        "dataset-12",
        "dataset-12",
        "digest-25",
        "digest-25",
        False,
    ) is False


def test_c2pa_chain_matches_is_symmetric_between_chain_sides():
    forward = c2pa_chain_matches("a", "a", "b", "b", True)
    reversed_sides = c2pa_chain_matches("a", "a", "b", "b", True)
    assert forward == reversed_sides
