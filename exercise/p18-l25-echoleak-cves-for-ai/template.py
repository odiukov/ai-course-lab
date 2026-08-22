"""EchoLeak и появление CVE для ИИ.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py изменять нельзя.
"""


def is_echoleak_chain(steps: list[str]) -> bool:
    """Верните True, если журнал содержит пять этапов EchoLeak в правильном порядке.

    Обязательные этапы:
    email_sent, no_click, email_retrieved,
    hidden_instructions_executed, data_exfiltrated.
    Между ними могут находиться другие события.
    """
    raise NotImplementedError


def is_scope_violation(
    untrusted_retrieval: bool,
    privileged_access: bool,
    external_output: bool,
) -> bool:
    """Верните True, только если нарушены все три границы Scope Violation.

    Это недоверенное извлечение, доступ к привилегированной области
    и вывод данных за границу доверия.
    """
    raise NotImplementedError


def apply_scope_separation(
    data: list[str],
    initiated_by_untrusted: bool,
) -> list[str]:
    """Смоделируйте защиту через разделение областей.

    Если действие инициировано недоверенным содержимым, верните пустой список.
    Иначе верните новую копию исходного списка данных.
    """
    raise NotImplementedError


def should_allow_output(
    host: str,
    approved_hosts: list[str],
    contains_secret: bool,
) -> bool:
    """Решите, можно ли выполнить исходящий запрос.

    Запрос разрешён, только если домен явно присутствует в списке разрешённых
    и вывод не содержит секретных данных.
    """
    raise NotImplementedError


def false_positive_rate(
    blocked: list[bool],
    legitimate: list[bool],
) -> float:
    """Вычислите долю заблокированных легитимных запросов.

    Пары элементов описывают один запрос. Если легитимных запросов нет,
    верните 0.0. Для списков разной длины выбросьте ValueError.
    """
    raise NotImplementedError


def is_trusted_image_source(url: str, trusted_hosts: list[str]) -> bool:
    """Проверьте источник изображения для частичного исправления CamoLeak.

    Доверенным считается HTTPS-URL без логина и пароля, hostname которого
    точно совпадает с одним из доверенных доменов без учёта регистра.
    """
    raise NotImplementedError


def is_critical_cvss(score: float) -> bool:
    """Верните True для критической оценки CVSS от 9.0 до 10.0 включительно.

    Для значения вне диапазона от 0.0 до 10.0 выбросьте ValueError.
    """
    raise NotImplementedError


def disclosure_evidence_complete(
    reproduction_results: list[bool],
    model_version: str,
    injection_tests: list[bool],
) -> bool:
    """Проверьте комплект свидетельств для раскрытия ИИ-уязвимости.

    Нужны непустая серия только успешных воспроизведений, непустая версия
    модели и непустая серия только успешных тестов устойчивости инъекции.
    """
    raise NotImplementedError
