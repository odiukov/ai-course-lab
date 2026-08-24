"""Семейство Direct Preference Optimization.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def implicit_reward_gap(
    beta,
    chosen_logprob,
    chosen_ref_logprob,
    rejected_logprob,
    rejected_ref_logprob,
):
    """Вычислите разрыв неявной награды между chosen и rejected ответами."""
    raise NotImplementedError


def dpo_loss(beta, chosen_log_ratio, rejected_log_ratio):
    """Вычислите устойчивую к большим числам DPO-потерю через log-sigmoid."""
    raise NotImplementedError


def ipo_loss(beta, chosen_log_ratio, rejected_log_ratio):
    """Вычислите IPO-потерю с ограниченной целью 1 / (2 * beta)."""
    raise NotImplementedError


def kto_loss(beta, log_ratio, desirable, z_ref=0.0, loss_aversion=1.0):
    """Вычислите KTO-потерю для одного desirable или undesirable ответа."""
    raise NotImplementedError


def simpo_loss(
    beta,
    chosen_logprob,
    chosen_length,
    rejected_logprob,
    rejected_length,
    gamma=0.0,
):
    """Вычислите SimPO-потерю с нормировкой логарифмов на длину ответов."""
    raise NotImplementedError


def orpo_loss(chosen_probability, rejected_probability, preference_weight=1.0):
    """Сложите NLL chosen-ответа и взвешенную ORPO-потерю отношения шансов."""
    raise NotImplementedError


def bpo_loss(
    beta,
    chosen_log_ratio,
    rejected_log_ratio,
    chosen_logprob_before,
    chosen_logprob_after,
    preservation_weight=1.0,
):
    """Добавьте к DPO штраф за снижение логарифма вероятности chosen-ответа."""
    raise NotImplementedError
