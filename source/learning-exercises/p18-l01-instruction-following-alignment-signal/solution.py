import math


def sft_policy(demonstrations, actions=("A", "B", "C")):
    counts = {action: 0 for action in actions}
    for action in demonstrations:
        if action not in counts:
            raise ValueError("Неизвестное действие")
        counts[action] += 1
    if not demonstrations:
        return {action: 1.0 / len(actions) for action in actions} if actions else {}
    return {action: counts[action] / len(demonstrations) for action in actions}


def bradley_terry_loss(winner_reward, loser_reward):
    difference = winner_reward - loser_reward
    if difference >= 0:
        return math.log1p(math.exp(-difference))
    return -difference + math.log1p(math.exp(difference))


def kl_divergence(policy, reference):
    if len(policy) != len(reference):
        raise ValueError("Распределения должны иметь одинаковую длину")
    total = 0.0
    for probability, anchor in zip(policy, reference):
        if probability < 0 or anchor < 0:
            raise ValueError("Вероятности не могут быть отрицательными")
        if probability > 0 and anchor == 0:
            return math.inf
        if probability > 0:
            total += probability * math.log(probability / anchor)
    return total


def rlhf_objective(policy, reference, rewards, beta):
    if len(policy) != len(reference) or len(policy) != len(rewards):
        raise ValueError("Все последовательности должны иметь одинаковую длину")
    if beta < 0:
        raise ValueError("beta не может быть отрицательным")
    expected_reward = sum(p * reward for p, reward in zip(policy, rewards))
    if beta == 0:
        return expected_reward
    return expected_reward - beta * kl_divergence(policy, reference)


def kl_anchored_policy(reference, rewards, beta):
    if len(reference) != len(rewards):
        raise ValueError("Списки должны иметь одинаковую длину")
    if beta <= 0:
        raise ValueError("beta должно быть положительным")
    if any(probability < 0 for probability in reference):
        raise ValueError("Вероятности не могут быть отрицательными")
    if not reference:
        return []
    if not any(reference):
        raise ValueError("Нужна хотя бы одна положительная вероятность")
    peak = max(r / beta for p, r in zip(reference, rewards) if p > 0)
    weights = [p * math.exp(r / beta - peak) if p else 0.0
               for p, r in zip(reference, rewards)]
    total = sum(weights)
    return [weight / total for weight in weights]


def alignment_tax(before_scores, after_scores):
    if len(before_scores) != len(after_scores):
        raise ValueError("Списки должны иметь одинаковую длину")
    if not before_scores:
        return 0.0
    drops = (before - after for before, after in zip(before_scores, after_scores))
    return sum(drops) / len(before_scores)


def ppo_ptx_objective(rlhf_score, token_probabilities, gamma):
    if gamma < 0:
        raise ValueError("gamma не может быть отрицательным")
    if any(p < 0 or p > 1 for p in token_probabilities):
        raise ValueError("Вероятность должна лежать между 0 и 1")
    if not token_probabilities or gamma == 0:
        return rlhf_score
    if any(p == 0 for p in token_probabilities):
        return -math.inf
    mean_log_probability = sum(map(math.log, token_probabilities))
    return rlhf_score + gamma * mean_log_probability / len(token_probabilities)
