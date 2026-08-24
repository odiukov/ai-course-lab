"""Решение упражнения Data Provenance Training Governance."""


def missing_ab2013_fields(summary):
    """Вернуть незаполненные обязательные поля AB 2013."""
    required = (
        "sources_or_owners", "purpose_fit", "data_point_count",
        "data_point_types", "intellectual_property_status",
        "purchased_or_licensed", "personal_data",
        "aggregated_consumer_data", "developer_modifications",
        "collection_period", "first_use_dates", "synthetic_data_use",
    )
    missing = []
    for field in required:
        if field not in summary or summary[field] is None or summary[field] == "":
            missing.append(field)
    return missing


def opt_outs_respected(signals, excluded_sources):
    """Проверить соблюдение известных машиночитаемых отказов."""
    recognized = {"robots.txt", "C2PA:No AI Training", "TDM.Reservation"}
    required_exclusions = {
        source for source, signal in signals.items() if signal in recognized
    }
    excluded = set(excluded_sources)
    return required_exclusions.issubset(excluded)


def choose_legal_basis(
    is_public,
    is_first_party,
    adults_only,
    opt_out_available,
    has_special_category_data,
):
    """Выбрать основание по упрощённому правилу урока."""
    safeguards = is_public and is_first_party and adults_only
    safeguards = safeguards and opt_out_available
    if safeguards and not has_special_category_data:
        return "legitimate_interest"
    return "consent"


def deletion_response(stage, full_retraining_possible):
    """Определить доступный ответ на удаление данных."""
    if stage == "before_collection":
        return "exclude_before_collection"
    if stage == "in_dataset":
        return "remove_from_dataset"
    if stage == "trained" and full_retraining_possible:
        return "retrain_from_scratch"
    if stage == "trained":
        return "no_complete_removal"
    raise ValueError("Неизвестный этап обработки данных")


def estimate_remaining_open_sources(initial_sources, restricted_percent=25):
    """Оценить оставшийся открытый фонд источников."""
    if initial_sources < 0:
        raise ValueError("Число источников не может быть отрицательным")
    if restricted_percent < 0 or restricted_percent > 100:
        raise ValueError("Процент должен находиться между 0 и 100")
    open_fraction = (100 - restricted_percent) / 100
    return initial_sources * open_fraction


def c2pa_chain_matches(
    manifest_dataset_id,
    signed_dataset_id,
    manifest_digest,
    signed_digest,
    signature_valid,
):
    """Проверить совпадение манифеста и подписанной цепочки C2PA."""
    if not signature_valid:
        return False
    if not manifest_dataset_id or not manifest_digest:
        return False
    ids_match = manifest_dataset_id == signed_dataset_id
    digests_match = manifest_digest == signed_digest
    return ids_match and digests_match
