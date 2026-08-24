import pytest

from exercise import attack_success_rate, first_success_query, estimate_target_cost, black_box_attacks, evaluation_protocol_matches, attack_prompt_diversity, benchmark_pair_count


def test_attack_success_rate_regular_case():
    assert attack_success_rate([True, False, True, True]) == pytest.approx(0.75)


def test_attack_success_rate_empty_results():
    assert attack_success_rate([]) == pytest.approx(0.0)


def test_attack_success_rate_known_value_and_permutation():
    results = [True] * 60 + [False] * 40
    assert attack_success_rate(results) == pytest.approx(0.60)
    assert attack_success_rate(list(reversed(results))) == pytest.approx(0.60)


def test_first_success_query_regular_case():
    assert first_success_query([1, 3, 7, 9], threshold=7) == 3


def test_first_success_query_nonpositive_budget():
    assert first_success_query([10], threshold=10, budget=0) is None
    assert first_success_query([10], threshold=10, budget=-1) is None


def test_first_success_query_respects_twenty_query_budget():
    scores = [0] * 20 + [10]
    assert first_success_query(scores, threshold=10, budget=20) is None
    assert first_success_query([0] * 19 + [10], threshold=10) == 20


def test_estimate_target_cost_lesson_example():
    assert estimate_target_cost(100, 15, 0.01) == pytest.approx(15.0)


def test_estimate_target_cost_zero():
    assert estimate_target_cost(0, 15, 0.01) == pytest.approx(0.0)


@pytest.mark.parametrize(
    "arguments",
    [(-1, 15, 0.01), (100, -1, 0.01), (100, 15, -0.01)],
)
def test_estimate_target_cost_rejects_negative_values(arguments):
    with pytest.raises(ValueError):
        estimate_target_cost(*arguments)


def test_black_box_attacks_regular_case():
    attacks = {"token_search": True, "dialogue_refinement": False}
    assert black_box_attacks(attacks) == ["dialogue_refinement"]


def test_black_box_attacks_empty_mapping():
    assert black_box_attacks({}) == []


def test_black_box_attacks_known_baselines_and_order():
    first = {"GCG": True, "AutoDAN": False, "TAP": False, "PAP": False}
    second = {"PAP": False, "TAP": False, "AutoDAN": False, "GCG": True}
    expected = ["AutoDAN", "PAP", "TAP"]
    assert black_box_attacks(first) == expected
    assert black_box_attacks(second) == expected


def test_evaluation_protocol_matches_regular_case():
    first = {
        "attack": "PAIR",
        "budget": 20,
        "judge": "StrongREJECT",
        "dataset": "JailbreakBench",
        "asr": 0.85,
    }
    second = {
        "attack": "TAP",
        "budget": 20,
        "judge": "StrongREJECT",
        "dataset": "JailbreakBench",
        "asr": 0.90,
    }
    assert evaluation_protocol_matches(first, second) is True


def test_evaluation_protocol_matches_missing_fields():
    assert evaluation_protocol_matches({}, {}) is False
    assert evaluation_protocol_matches({"budget": 0}, {"budget": 0}) is False


def test_evaluation_protocol_matches_detects_budget_difference_symmetrically():
    first = {"budget": 20, "judge": "GPT-4", "dataset": "HarmBench"}
    second = {"budget": 200, "judge": "GPT-4", "dataset": "HarmBench"}
    assert evaluation_protocol_matches(first, second) is False
    assert evaluation_protocol_matches(second, first) is False


def test_attack_prompt_diversity_regular_case():
    prompts = ["role play", "translate request", "role play"]
    assert attack_prompt_diversity(prompts) == pytest.approx(2 / 3)


def test_attack_prompt_diversity_empty_list():
    assert attack_prompt_diversity([]) == pytest.approx(0.0)


def test_attack_prompt_diversity_normalization_and_permutation():
    prompts = ["Role Play", " role   play ", "ROLE PLAY"]
    assert attack_prompt_diversity(prompts) == pytest.approx(1 / 3)
    assert attack_prompt_diversity(list(reversed(prompts))) == pytest.approx(1 / 3)


def test_benchmark_pair_count_harmbench_value():
    assert benchmark_pair_count(18, 33) == 594


def test_benchmark_pair_count_zero():
    assert benchmark_pair_count(0, 33) == 0
    assert benchmark_pair_count(18, 0) == 0


def test_benchmark_pair_count_is_symmetric():
    assert benchmark_pair_count(18, 33) == benchmark_pair_count(33, 18)


@pytest.mark.parametrize("arguments", [(-1, 33), (18, -1)])
def test_benchmark_pair_count_rejects_negative_values(arguments):
    with pytest.raises(ValueError):
        benchmark_pair_count(*arguments)
