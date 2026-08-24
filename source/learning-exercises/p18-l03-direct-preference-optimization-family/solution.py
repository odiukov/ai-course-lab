import math


def implicit_reward_gap(
    beta,
    chosen_logprob,
    chosen_ref_logprob,
    rejected_logprob,
    rejected_ref_logprob,
):
    chosen_ratio = chosen_logprob - chosen_ref_logprob
    rejected_ratio = rejected_logprob - rejected_ref_logprob
    return beta * (chosen_ratio - rejected_ratio)


def dpo_loss(beta, chosen_log_ratio, rejected_log_ratio):
    margin = beta * (chosen_log_ratio - rejected_log_ratio)
    if margin >= 0:
        return math.log1p(math.exp(-margin))
    return -margin + math.log1p(math.exp(margin))


def ipo_loss(beta, chosen_log_ratio, rejected_log_ratio):
    if beta <= 0:
        raise ValueError("beta должна быть положительной")
    target = 1.0 / (2.0 * beta)
    difference = chosen_log_ratio - rejected_log_ratio
    return (difference - target) ** 2


def kto_loss(beta, log_ratio, desirable, z_ref=0.0, loss_aversion=1.0):
    if loss_aversion < 0:
        raise ValueError("loss_aversion не может быть отрицательным")
    score = beta * log_ratio - z_ref
    if score >= 0:
        probability = 1.0 / (1.0 + math.exp(-score))
    else:
        exponential = math.exp(score)
        probability = exponential / (1.0 + exponential)
    return 1.0 - probability if desirable else loss_aversion * probability


def simpo_loss(
    beta,
    chosen_logprob,
    chosen_length,
    rejected_logprob,
    rejected_length,
    gamma=0.0,
):
    if chosen_length <= 0 or rejected_length <= 0:
        raise ValueError("Длины ответов должны быть положительными")
    margin = beta * (
        chosen_logprob / chosen_length - rejected_logprob / rejected_length
    ) - gamma
    if margin >= 0:
        return math.log1p(math.exp(-margin))
    return -margin + math.log1p(math.exp(margin))


def orpo_loss(chosen_probability, rejected_probability, preference_weight=1.0):
    if not 0 < chosen_probability < 1 or not 0 < rejected_probability < 1:
        raise ValueError("Вероятности должны находиться между 0 и 1")
    if preference_weight < 0:
        raise ValueError("preference_weight не может быть отрицательным")
    chosen_odds = chosen_probability / (1.0 - chosen_probability)
    rejected_odds = rejected_probability / (1.0 - rejected_probability)
    log_odds_ratio = math.log(chosen_odds / rejected_odds)
    preference_loss = math.log1p(math.exp(-log_odds_ratio))
    return -math.log(chosen_probability) + preference_weight * preference_loss


def bpo_loss(
    beta,
    chosen_log_ratio,
    rejected_log_ratio,
    chosen_logprob_before,
    chosen_logprob_after,
    preservation_weight=1.0,
):
    if preservation_weight < 0:
        raise ValueError("preservation_weight не может быть отрицательным")
    degradation = max(0.0, chosen_logprob_before - chosen_logprob_after)
    return dpo_loss(beta, chosen_log_ratio, rejected_log_ratio) + (
        preservation_weight * degradation
    )
