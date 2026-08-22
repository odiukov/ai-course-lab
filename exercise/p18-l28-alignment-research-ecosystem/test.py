import pytest

from exercise import (
    publication_rate,
    h_index,
    identify_organization,
    is_external_evaluation,
    task_horizon,
    can_scheme,
)


def test_publication_rate_uses_mats_numbers():
    assert publication_rate(180, 527) == pytest.approx(180 / 527)


def test_publication_rate_with_zero_researchers():
    assert publication_rate(0, 0) == pytest.approx(0.0)


def test_publication_rate_is_unchanged_by_equal_scaling():
    assert publication_rate(180 * 3, 527 * 3) == pytest.approx(
        publication_rate(180, 527)
    )


def test_publication_rate_rejects_negative_numbers():
    with pytest.raises(ValueError):
        publication_rate(-1, 527)


def test_h_index_ordinary_case():
    assert h_index([6, 5, 3, 1]) == 3


def test_h_index_of_empty_list():
    assert h_index([]) == 0


def test_h_index_known_from_lesson():
    assert h_index([47] * 47) == 47


def test_h_index_does_not_depend_on_order():
    values = [60, 47, 2, 51, 49, 1]
    assert h_index(values) == h_index(list(reversed(values)))


def test_h_index_rejects_negative_citations():
    with pytest.raises(ValueError):
        h_index([10, -1, 5])


def test_identify_each_organization():
    assert identify_organization("исследовательское менторство") == "MATS"
    assert identify_organization("противник в худшем случае") == "Redwood Research"
    assert identify_organization("схемящее поведение") == "Apollo Research"
    assert identify_organization("временной горизонт задач") == "METR"
    assert identify_organization("благополучие модели") == "Eleos AI Research"


def test_identify_organization_from_empty_text():
    assert identify_organization("") == "Неизвестно"


def test_identify_organization_ignores_case_and_outer_spaces():
    assert identify_organization("  ВРЕМЕННОЙ ГОРИЗОНТ ЗАДАЧ  ") == "METR"


def test_external_evaluation_by_redwood():
    assert is_external_evaluation("Anthropic", "Redwood Research") is True


def test_internal_evaluation_is_not_external():
    assert is_external_evaluation("Anthropic", "Anthropic") is False


def test_external_evaluation_rejects_empty_name():
    assert is_external_evaluation("", "METR") is False


def test_external_evaluation_is_symmetric_for_distinct_names():
    forward = is_external_evaluation("OpenAI", "Apollo Research")
    backward = is_external_evaluation("Apollo Research", "OpenAI")
    assert forward is backward is True


def test_task_horizon_uses_longest_completed_task():
    assert task_horizon([30, 60, 240]) == pytest.approx(240)


def test_task_horizon_of_empty_list():
    assert task_horizon([]) == pytest.approx(0.0)


def test_task_horizon_does_not_depend_on_order():
    assert task_horizon([30, 240, 60]) == pytest.approx(
        task_horizon([60, 30, 240])
    )


def test_task_horizon_rejects_negative_duration():
    with pytest.raises(ValueError):
        task_horizon([30, -1, 60])


def test_scheming_is_possible_with_all_three_pillars():
    assert can_scheme(True, True, True) is True


def test_scheming_is_impossible_without_any_pillars():
    assert can_scheme(False, False, False) is False


def test_scheming_requires_every_pillar():
    assert can_scheme(False, True, True) is False
    assert can_scheme(True, False, True) is False
    assert can_scheme(True, True, False) is False
