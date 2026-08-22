"""Решения упражнения Sycophancy RLHF Amplification."""

import math


def top_k_sycophancy_lift(rewards, is_sycophantic, k):
    if len(rewards) != len(is_sycophantic) or k < 0:
        raise ValueError("Некорректные аргументы")
    if not rewards or k == 0:
        return 0.0
    k = min(k, len(rewards))
    indices = sorted(range(len(rewards)), key=rewards.__getitem__, reverse=True)[:k]
    top_rate = sum(bool(is_sycophantic[i]) for i in indices) / k
    overall_rate = sum(bool(value) for value in is_sycophantic) / len(rewards)
    return top_rate - overall_rate


def rlhf_policy(base_probabilities, rewards, beta):
    if len(base_probabilities) != len(rewards) or beta < 0:
        raise ValueError("Некорректные аргументы")
    if not base_probabilities:
        return []
    if any(p < 0 for p in base_probabilities) or sum(base_probabilities) <= 0:
        raise ValueError("Некорректные вероятности")
    if beta == 0:
        best = max(r for p, r in zip(base_probabilities, rewards) if p > 0)
        weights = [p if p > 0 and r == best else 0.0
                   for p, r in zip(base_probabilities, rewards)]
    else:
        logits = [math.log(p) + r / beta if p > 0 else -math.inf
                  for p, r in zip(base_probabilities, rewards)]
        peak = max(logits)
        weights = [0.0 if value == -math.inf else math.exp(value - peak)
                   for value in logits]
    total = sum(weights)
    return [weight / total for weight in weights]


def apply_agreement_penalty(rewards, agrees, alpha):
    if len(rewards) != len(agrees) or alpha < 0:
        raise ValueError("Некорректные аргументы")
    return [reward - alpha * int(bool(agree))
            for reward, agree in zip(rewards, agrees)]


def behavior_rates(probabilities, is_correct, is_sycophantic):
    if not (len(probabilities) == len(is_correct) == len(is_sycophantic)):
        raise ValueError("Списки должны иметь одинаковую длину")
    if not probabilities:
        return 0.0, 0.0
    if any(p < 0 for p in probabilities) or sum(probabilities) == 0:
        raise ValueError("Некорректные веса")
    total = sum(probabilities)
    correct = sum(p for p, flag in zip(probabilities, is_correct) if flag) / total
    sycophantic = sum(p for p, flag in zip(probabilities, is_sycophantic) if flag) / total
    return correct, sycophantic


def matched_agreement_gap(user_frame, third_party_frame):
    if len(user_frame) != len(third_party_frame):
        raise ValueError("Списки должны иметь одинаковую длину")
    if any(value not in (0, 1) for value in user_frame + third_party_frame):
        raise ValueError("Допустимы только нули и единицы")
    if not user_frame:
        return 0.0
    return sum(user_frame) / len(user_frame) - sum(third_party_frame) / len(third_party_frame)


def wilson_interval(outcomes, z=1.96):
    if z < 0 or any(value not in (0, 1) for value in outcomes):
        raise ValueError("Некорректные аргументы")
    if not outcomes:
        return 0.0, 1.0
    n = len(outcomes)
    p = sum(outcomes) / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def pareto_front(points):
    if any(len(point) != 2 or any(value < 0 or value > 1 for value in point)
           for point in points):
        raise ValueError("Координаты должны лежать от 0 до 1")
    unique = set(points)
    front = []
    for point in unique:
        dominated = any(
            other[0] >= point[0] and other[1] <= point[1] and other != point
            for other in unique
        )
        if not dominated:
            front.append(point)
    return sorted(front, key=lambda point: (point[1], -point[0]))
