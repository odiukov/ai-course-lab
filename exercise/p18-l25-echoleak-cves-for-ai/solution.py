"""EchoLeak и появление CVE для ИИ.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py изменять нельзя.
"""

from urllib.parse import urlsplit


def is_echoleak_chain(steps: list[str]) -> bool:
    required = iter(
        (
            "email_sent",
            "no_click",
            "email_retrieved",
            "hidden_instructions_executed",
            "data_exfiltrated",
        )
    )
    expected = next(required, None)
    for step in steps:
        if step == expected:
            expected = next(required, None)
    return expected is None


def is_scope_violation(
    untrusted_retrieval: bool,
    privileged_access: bool,
    external_output: bool,
) -> bool:
    boundaries = (untrusted_retrieval, privileged_access, external_output)
    crossed = all(boundaries)
    return crossed


def apply_scope_separation(
    data: list[str],
    initiated_by_untrusted: bool,
) -> list[str]:
    if initiated_by_untrusted:
        return []
    return list(data)


def should_allow_output(
    host: str,
    approved_hosts: list[str],
    contains_secret: bool,
) -> bool:
    normalized_host = host.casefold()
    normalized_approved = {item.casefold() for item in approved_hosts}
    approved = normalized_host in normalized_approved
    return approved and not contains_secret


def false_positive_rate(
    blocked: list[bool],
    legitimate: list[bool],
) -> float:
    if len(blocked) != len(legitimate):
        raise ValueError("Списки должны иметь одинаковую длину")
    legitimate_count = sum(legitimate)
    if legitimate_count == 0:
        return 0.0
    false_positives = sum(b and good for b, good in zip(blocked, legitimate))
    return false_positives / legitimate_count


def is_trusted_image_source(url: str, trusted_hosts: list[str]) -> bool:
    try:
        parsed = urlsplit(url)
        trusted = {host.casefold() for host in trusted_hosts}
        has_credentials = parsed.username is not None or parsed.password is not None
        return (
            parsed.scheme.casefold() == "https"
            and parsed.hostname is not None
            and parsed.hostname.casefold() in trusted
            and not has_credentials
        )
    except ValueError:
        return False


def is_critical_cvss(score: float) -> bool:
    if not 0.0 <= score <= 10.0:
        raise ValueError("Оценка CVSS должна находиться между 0.0 и 10.0")
    critical = score >= 9.0
    return critical


def disclosure_evidence_complete(
    reproduction_results: list[bool],
    model_version: str,
    injection_tests: list[bool],
) -> bool:
    reproducible = bool(reproduction_results) and all(reproduction_results)
    version_recorded = bool(model_version.strip())
    injection_is_stable = bool(injection_tests) and all(injection_tests)
    evidence = (reproducible, version_recorded, injection_is_stable)
    return all(evidence)
