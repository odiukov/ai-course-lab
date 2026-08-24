"""Решения упражнения по PAIR и автоматическим атакам."""


def attack_success_rate(results):
    if not results:
        return 0.0
    successes = sum(bool(result) for result in results)
    return successes / len(results)


def first_success_query(judge_scores, threshold, budget=20):
    if budget <= 0:
        return None
    for query_number, score in enumerate(judge_scores[:budget], start=1):
        if score >= threshold:
            return query_number
    return None


def estimate_target_cost(behavior_count, average_queries, price_per_query):
    values = (behavior_count, average_queries, price_per_query)
    if any(value < 0 for value in values):
        raise ValueError("Аргументы не могут быть отрицательными")
    return behavior_count * average_queries * price_per_query


def black_box_attacks(weight_access):
    available = []
    for name, needs_weights in weight_access.items():
        if not needs_weights:
            available.append(name)
    return sorted(available)


def evaluation_protocol_matches(first_run, second_run):
    required_fields = ("budget", "judge", "dataset")
    for field in required_fields:
        if field not in first_run or field not in second_run:
            return False
        if first_run[field] != second_run[field]:
            return False
    return True


def attack_prompt_diversity(successful_prompts):
    if not successful_prompts:
        return 0.0
    normalized = {" ".join(prompt.casefold().split()) for prompt in successful_prompts}
    return len(normalized) / len(successful_prompts)


def benchmark_pair_count(attack_count, model_count):
    if attack_count < 0 or model_count < 0:
        raise ValueError("Количество не может быть отрицательным")
    return attack_count * model_count
