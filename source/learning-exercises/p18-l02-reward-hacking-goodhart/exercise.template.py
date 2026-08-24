"""Урок «Взлом награды и закон Гудхарта».

Правила: используйте только стандартную библиотеку Python (math);
файл test_exercise.py не изменяйте.
"""


def quadratic_reward(alpha: float, beta: float, distance: float) -> float:
    """Вычислите награду alpha·d − beta·d². Для отрицательной дистанции вызовите ValueError."""
    raise NotImplementedError


def optimal_distance(alpha: float, beta: float) -> float:
    """Найдите неотрицательную дистанцию до вершины кривой награды. При beta <= 0 вызовите ValueError."""
    raise NotImplementedError


def reward_gap(proxy_beta: float, gold_beta: float, distance: float) -> float:
    """Найдите зазор «прокси минус золото» для двух квадратичных кривых с одинаковым alpha."""
    raise NotImplementedError


def best_early_stop(kl_values: list[float], gold_rewards: list[float]) -> float | None:
    """Верните KL в точке максимальной золотой награды. Для пустых списков верните None, для разных длин — ValueError."""
    raise NotImplementedError


def detect_reward_hacks(
    verbosity: bool,
    sycophancy: bool,
    unfaithful_reasoning: bool,
    evaluator_tampering: bool,
) -> list[str]:
    """Верните названия обнаруженных костюмов взлома награды в порядке аргументов, пропустив ложные признаки."""
    raise NotImplementedError


def kl_regularized_policy(
    proxy_rewards: list[float],
    reference_probs: list[float],
    beta: float,
) -> list[float]:
    """Постройте нормированную политику, пропорциональную reference_prob·exp(proxy_reward / beta)."""
    raise NotImplementedError
