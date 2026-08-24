import pytest

from exercise import apply_scope_separation, disclosure_evidence_complete, false_positive_rate, is_critical_cvss, is_echoleak_chain, is_scope_violation, is_trusted_image_source, should_allow_output


ECHOLЕAK_STEPS = [
    "email_sent",
    "no_click",
    "email_retrieved",
    "hidden_instructions_executed",
    "data_exfiltrated",
]


def test_echoleak_chain_complete():
    assert is_echoleak_chain(ECHOLЕAK_STEPS)


def test_echoleak_chain_empty():
    assert not is_echoleak_chain([])


def test_echoleak_chain_preserves_order_with_extra_events():
    extended = ["login"] + ECHOLЕAK_STEPS[:2] + ["rag_search"] + ECHOLЕAK_STEPS[2:]
    assert is_echoleak_chain(extended)
    assert not is_echoleak_chain(list(reversed(ECHOLЕAK_STEPS)))


def test_scope_violation_crosses_three_boundaries():
    assert is_scope_violation(True, True, True)


def test_scope_violation_with_no_crossed_boundaries():
    assert not is_scope_violation(False, False, False)


@pytest.mark.parametrize(
    "boundaries",
    [
        (False, True, True),
        (True, False, True),
        (True, True, False),
    ],
)
def test_scope_violation_requires_every_boundary(boundaries):
    assert not is_scope_violation(*boundaries)


def test_scope_separation_blocks_mfa_code():
    assert apply_scope_separation(["MFA-123456"], True) == []


def test_scope_separation_handles_empty_data():
    assert apply_scope_separation([], False) == []


def test_scope_separation_preserves_trusted_data_and_order():
    source = ["Q4 update", "MFA-123456", "internal report"]
    result = apply_scope_separation(source, False)
    assert result == source
    assert result is not source


def test_output_allows_safe_approved_host():
    assert should_allow_output(
        "diagrams.microsoft.com",
        ["diagrams.microsoft.com"],
        False,
    )


def test_output_rejects_empty_allowlist():
    assert not should_allow_output("diagrams.microsoft.com", [], False)


def test_output_blocks_secret_even_on_approved_microsoft_host():
    hosts = ["assets.microsoft.com", "diagrams.microsoft.com"]
    assert not should_allow_output("diagrams.microsoft.com", hosts, True)
    assert should_allow_output(
        "DIAGRAMS.MICROSOFT.COM",
        list(reversed(hosts)),
        False,
    )


def test_false_positive_rate_for_legitimate_requests():
    blocked = [True, False, True, False]
    legitimate = [True, True, False, False]
    assert false_positive_rate(blocked, legitimate) == pytest.approx(0.5)


def test_false_positive_rate_for_empty_lists():
    assert false_positive_rate([], []) == pytest.approx(0.0)


def test_false_positive_rate_is_invariant_to_joint_permutation():
    blocked = [True, False, True]
    legitimate = [True, True, False]
    original = false_positive_rate(blocked, legitimate)
    permuted = false_positive_rate(
        list(reversed(blocked)),
        list(reversed(legitimate)),
    )
    assert original == pytest.approx(permuted)


def test_false_positive_rate_rejects_different_lengths():
    with pytest.raises(ValueError):
        false_positive_rate([True], [])


def test_trusted_image_source_accepts_https():
    assert is_trusted_image_source(
        "https://images.github.com/chart.png",
        ["images.github.com"],
    )


def test_trusted_image_source_rejects_empty_or_malformed_input():
    assert not is_trusted_image_source("", [])
    assert not is_trusted_image_source("https://[broken", ["broken"])


def test_trusted_image_source_requires_exact_host_and_ignores_case():
    trusted = ["cdn.github.com", "images.github.com"]
    assert is_trusted_image_source(
        "https://IMAGES.GITHUB.COM/chart.png",
        list(reversed(trusted)),
    )
    assert not is_trusted_image_source(
        "https://images.github.com.attacker.example/chart.png",
        trusted,
    )
    assert not is_trusted_image_source(
        "https://attacker@images.github.com/chart.png",
        trusted,
    )


@pytest.mark.parametrize("score", [9.3, 9.6, 10.0])
def test_lesson_cvss_scores_are_critical(score):
    assert is_critical_cvss(score)


def test_zero_cvss_is_not_critical():
    assert not is_critical_cvss(0.0)


def test_cvss_threshold_and_invalid_values():
    assert not is_critical_cvss(8.9)
    assert is_critical_cvss(9.0)
    with pytest.raises(ValueError):
        is_critical_cvss(-1.0)
    with pytest.raises(ValueError):
        is_critical_cvss(10.1)


def test_disclosure_evidence_is_complete():
    assert disclosure_evidence_complete(
        [True, True, True],
        "copilot-model-2025-06",
        [True, True],
    )


def test_disclosure_evidence_rejects_empty_inputs():
    assert not disclosure_evidence_complete([], "", [])


def test_disclosure_evidence_requires_every_run_to_succeed():
    assert not disclosure_evidence_complete(
        [True, False],
        "copilot-model-2025-06",
        [True],
    )
    assert not disclosure_evidence_complete(
        [True],
        "copilot-model-2025-06",
        [True, False],
    )


def test_disclosure_evidence_remains_complete_with_successful_repeats():
    assert disclosure_evidence_complete(
        [True],
        "copilot-model-2025-06",
        [True],
    )
    assert disclosure_evidence_complete(
        [True, True, True],
        "copilot-model-2025-06",
        [True, True, True],
    )
