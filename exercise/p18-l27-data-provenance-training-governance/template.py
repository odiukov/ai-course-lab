"""Data Provenance Training Governance.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def missing_ab2013_fields(summary):
    """Верните названия недостаточно заполненных полей AB 2013.

    Обязательные поля: sources_or_owners, purpose_fit, data_point_count,
    data_point_types, intellectual_property_status, purchased_or_licensed,
    personal_data, aggregated_consumer_data, developer_modifications,
    collection_period, first_use_dates и synthetic_data_use.
    Поле недостаточно заполнено, если его нет, его значение равно None
    или является пустой строкой. Сохраните порядок из списка выше.
    """
    raise NotImplementedError


def opt_outs_respected(signals, excluded_sources):
    """Проверьте, исключены ли все источники с машиночитаемым отказом.

    signals — словарь вида «источник: сигнал». Сигналами отказа считаются
    точные строки robots.txt, C2PA:No AI Training и TDM.Reservation.
    Неизвестные сигналы не создают требования об исключении.
    """
    raise NotImplementedError


def choose_legal_basis(
    is_public,
    is_first_party,
    adults_only,
    opt_out_available,
    has_special_category_data,
):
    """Выберите упрощённое правовое основание по сценарию урока.

    Верните legitimate_interest, только если контент публичный, получен
    от собственных пользователей, принадлежит взрослым, доступен отказ
    и отсутствуют специальные категории данных. Иначе верните consent.
    """
    raise NotImplementedError


def deletion_response(stage, full_retraining_possible):
    """Определите ответ на требование удалить данные.

    stage принимает before_collection, in_dataset или trained.
    Верните соответственно exclude_before_collection, remove_from_dataset,
    retrain_from_scratch либо no_complete_removal. Для обученной модели
    полное удаление возможно только при полном переобучении.
    Для неизвестного этапа выбросьте ValueError.
    """
    raise NotImplementedError


def estimate_remaining_open_sources(initial_sources, restricted_percent=25):
    """Оцените число источников, оставшихся открытыми для обучения.

    initial_sources и restricted_percent не могут быть отрицательными,
    а процент не может превышать 100. Для недопустимого значения выбросьте
    ValueError. Результат может быть дробным.
    """
    raise NotImplementedError


def c2pa_chain_matches(
    manifest_dataset_id,
    signed_dataset_id,
    manifest_digest,
    signed_digest,
    signature_valid,
):
    """Проверьте связь манифеста датасета с подписанной цепочкой C2PA.

    Проверка успешна, если подпись действительна, идентификаторы совпадают,
    дайджесты совпадают, а идентификатор и дайджест не являются пустыми.
    """
    raise NotImplementedError
