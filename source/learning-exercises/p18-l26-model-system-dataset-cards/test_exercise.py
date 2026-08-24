import hashlib
import hmac
import json

import pytest

from exercise import (
    weak_sections,
    accuracy_by_group,
    ethics_documentation_percent,
    data_card_view,
    verify_attestation,
    system_card_coverage,
)


def test_weak_sections_detects_blanks_and_placeholders():
    required = ["Детали модели", "Этические соображения", "Оговорки"]
    card = {
        "Детали модели": "Классификатор отзывов",
        "Этические соображения": "   ",
        "Оговорки": "TODO",
    }
    assert weak_sections(card, required) == [
        "Этические соображения",
        "Оговорки",
    ]


def test_weak_sections_handles_empty_inputs():
    assert weak_sections({}, []) == []
    assert weak_sections({}, ["Метрики", "Обучающие данные"]) == [
        "Метрики",
        "Обучающие данные",
    ]


def test_weak_sections_preserves_required_order():
    card = {"Заполнен": "Есть свидетельства"}
    first = weak_sections(card, ["Первый", "Заполнен", "Второй"])
    second = weak_sections(card, ["Второй", "Заполнен", "Первый"])
    assert first == ["Первый", "Второй"]
    assert second == ["Второй", "Первый"]


def test_accuracy_by_group_uses_lesson_numbers():
    rows = (
        [("group_a", 1, 1)] * 97
        + [("group_a", 1, 0)] * 3
        + [("group_b", 1, 1)] * 71
        + [("group_b", 1, 0)] * 29
    )
    result = accuracy_by_group(rows)
    assert result["group_a"] == pytest.approx(0.97)
    assert result["group_b"] == pytest.approx(0.71)


def test_accuracy_by_group_handles_empty_rows():
    assert accuracy_by_group([]) == {}


def test_accuracy_by_group_is_permutation_invariant():
    rows = [
        ("signed_labels", -1, -1),
        ("signed_labels", -1, 1),
        ("signed_labels", 1, 1),
    ]
    forward = accuracy_by_group(rows)
    backward = accuracy_by_group(list(reversed(rows)))
    assert forward["signed_labels"] == pytest.approx(2 / 3)
    assert backward["signed_labels"] == pytest.approx(forward["signed_labels"])


def test_ethics_documentation_percent_matches_point_three_percent():
    assert ethics_documentation_percent(1000, 3) == pytest.approx(0.3)


def test_ethics_documentation_percent_handles_zero():
    assert ethics_documentation_percent(0, 0) == pytest.approx(0.0)


def test_ethics_documentation_percent_rejects_invalid_counts():
    with pytest.raises(ValueError):
        ethics_documentation_percent(-1000, 3)
    with pytest.raises(ValueError):
        ethics_documentation_percent(1000, -3)
    with pytest.raises(ValueError):
        ethics_documentation_percent(3, 4)


def test_ethics_documentation_percent_is_scale_invariant():
    small = ethics_documentation_percent(1000, 3)
    large = ethics_documentation_percent(2000, 6)
    assert large == pytest.approx(small)


def test_data_card_view_combines_layers_to_requested_depth():
    layers = {
        "telescopic": {"summary": "2 млн отзывов"},
        "periscopic": {"split": "80/20"},
        "microscopic": {"review_id": "Целое число"},
    }
    assert data_card_view(layers, "periscopic") == {
        "summary": "2 млн отзывов",
        "split": "80/20",
    }


def test_data_card_view_handles_empty_layers_and_invalid_level():
    assert data_card_view({}, "telescopic") == {}
    with pytest.raises(ValueError):
        data_card_view({}, "macroscopic")


def test_data_card_views_grow_with_detail_level():
    layers = {
        "telescopic": {"summary": "Отзывы"},
        "periscopic": {"split": "80/20"},
        "microscopic": {"language": "Английский"},
    }
    telescopic = data_card_view(layers, "telescopic")
    periscopic = data_card_view(layers, "periscopic")
    microscopic = data_card_view(layers, "microscopic")
    assert telescopic.items() <= periscopic.items()
    assert periscopic.items() <= microscopic.items()


def test_verify_attestation_accepts_valid_signature():
    claim = {"metric": "accuracy", "value": 94}
    key = "verifier-key"
    payload = json.dumps(
        claim, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    signature = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    assert verify_attestation(claim, signature, key) is True


def test_verify_attestation_handles_empty_claim():
    claim = {}
    key = ""
    payload = json.dumps(
        claim, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    signature = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    assert verify_attestation(claim, signature, key) is True
    assert verify_attestation(claim, "0" * 64, key) is False


def test_verify_attestation_is_order_invariant_and_detects_tampering():
    claim = {"model": "demo", "value": 94}
    reordered = {"value": 94, "model": "demo"}
    key = "auditor"
    payload = json.dumps(
        claim, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    signature = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    assert verify_attestation(reordered, signature, key) is True
    assert verify_attestation({"model": "demo", "value": 71}, signature, key) is False


def test_system_card_coverage_counts_system_sections():
    card = {
        "safety_capabilities": "Фильтр опасных запросов",
        "prompt_injection_protection": "Изоляция инструкций",
        "data_exfiltration_detection": "Мониторинг ответов",
        "value_alignment": " ",
    }
    assert system_card_coverage(card) == pytest.approx(3 / 5)


def test_system_card_coverage_handles_empty_card():
    assert system_card_coverage({}) == pytest.approx(0.0)


def test_system_card_coverage_ignores_extra_model_sections():
    card = {
        "safety_capabilities": "Тесты",
        "prompt_injection_protection": "Фильтр",
        "data_exfiltration_detection": "Детектор",
        "value_alignment": "Оценка",
        "incident_response": "План",
        "training_data": "Описание датасета",
        "metrics": "Точность 94%",
    }
    assert system_card_coverage(card) == pytest.approx(1.0)
    card["training_data"] = ""
    assert system_card_coverage(card) == pytest.approx(1.0)
