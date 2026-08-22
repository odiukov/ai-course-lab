import math


def quadratic_reward(alpha: float, beta: float, distance: float) -> float:
    if distance < 0:
        raise ValueError("distance must be non-negative")
    return alpha * distance - beta * distance**2


def optimal_distance(alpha: float, beta: float) -> float:
    if beta <= 0:
        raise ValueError("beta must be positive")
    if alpha <= 0:
        return 0.0
    return alpha / (2 * beta)


def reward_gap(proxy_beta: float, gold_beta: float, distance: float) -> float:
    if distance < 0:
        raise ValueError("distance must be non-negative")
    return (gold_beta - proxy_beta) * distance**2


def best_early_stop(kl_values: list[float], gold_rewards: list[float]) -> float | None:
    if len(kl_values) != len(gold_rewards):
        raise ValueError("lists must have equal lengths")
    if not kl_values:
        return None
    best_index = max(range(len(gold_rewards)), key=gold_rewards.__getitem__)
    return kl_values[best_index]


def detect_reward_hacks(
    verbosity: bool,
    sycophancy: bool,
    unfaithful_reasoning: bool,
    evaluator_tampering: bool,
) -> list[str]:
    names = []
    signals = (
        (verbosity, "verbosity"),
        (sycophancy, "sycophancy"),
        (unfaithful_reasoning, "unfaithful_reasoning"),
        (evaluator_tampering, "evaluator_tampering"),
    )
    for detected, name in signals:
        if detected:
            names.append(name)
    return names


def kl_regularized_policy(
    proxy_rewards: list[float],
    reference_probs: list[float],
    beta: float,
) -> list[float]:
    if len(proxy_rewards) != len(reference_probs):
        raise ValueError("lists must have equal lengths")
    if not proxy_rewards:
        return []
    if beta <= 0 or any(probability < 0 for probability in reference_probs):
        raise ValueError("invalid beta or reference probability")
    scores = [
        math.log(probability) + reward / beta if probability else -math.inf
        for reward, probability in zip(proxy_rewards, reference_probs)
    ]
    peak = max(scores)
    if peak == -math.inf:
        raise ValueError("reference probabilities must have positive mass")
    weights = [0.0 if score == -math.inf else math.exp(score - peak) for score in scores]
    total = sum(weights)
    return [weight / total for weight in weights]
