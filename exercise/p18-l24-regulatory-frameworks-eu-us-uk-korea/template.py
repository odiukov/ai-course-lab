"""Regulatory Frameworks — EU, US, UK, Korea.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def classify_eu_risk(use_case):
    """Верните уровень риска EU AI Act для указанного сценария.

    Допустимые результаты: "prohibited", "high-risk",
    "general-purpose" и "limited-risk". Неизвестный или пустой сценарий
    должен приводить к ValueError.
    """
    raise NotImplementedError


def eu_act_deadline(obligation):
    """Верните дату начала применения обязательства в формате YYYY-MM-DD.

    Поддержите этапы из урока: prohibited, ai_literacy, gpai, governance,
    article_50, full_application, fines, legacy_gpai и embedded_high_risk.
    Для неизвестного обязательства вызовите ValueError.
    """
    raise NotImplementedError


def gpai_code_chapters(training_flops):
    """Верните кортеж применимых глав GPAI Code of Practice.

    Transparency и Copyright применяются ко всем GPAI. Safety and Security
    добавляется при системном риске от 1e25 FLOP включительно.
    Отрицательное количество FLOP должно приводить к ValueError.
    """
    raise NotImplementedError


def applicable_jurisdictions(company_country, infrastructure_region, user_countries):
    """Верните отсортированный кортеж применимых юрисдикций.

    В упрощённой модели учитывайте "US", "EU" и "Korea" по месту компании,
    инфраструктуры и пользователей. Неизвестные территории игнорируйте.
    """
    raise NotImplementedError


def korean_ai_obligations(foreign_provider, high_impact, generative):
    """Верните отсортированный кортеж обязательств Korean AI Framework Act.

    Иностранному провайдеру нужен local_representative, высоковоздействующей
    системе — risk_assessment, а high-impact и generative системам нужны
    safety_measures. Повторять обязательства нельзя.
    """
    raise NotImplementedError


def institute_policy_shift(country):
    """Верните (старое название, новое название, направление политики).

    Поддержите UK и US с переименованиями 2025 года. Регистр и пробелы
    не должны влиять на результат. Для другой страны вызовите ValueError.
    """
    raise NotImplementedError
