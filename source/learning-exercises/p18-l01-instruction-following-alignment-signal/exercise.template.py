"""Урок: Instruction Following Alignment Signal.

Правила: используйте только стандартную библиотеку Python;
файл test_exercise.py не изменять.
"""


def sft_policy(demonstrations, actions=("A", "B", "C")):
    """Постройте распределение SFT-политики по частотам действий в демонстрациях.

    Для пустого списка демонстраций верните равномерное распределение.
    Неизвестное действие должно приводить к ValueError.
    """
    raise NotImplementedError


def bradley_terry_loss(winner_reward, loser_reward):
    """Вычислите устойчивые попарные потери Брэдли — Терри.

    Результат должен зависеть только от разности наград победителя и проигравшего.
    """
    raise NotImplementedError


def kl_divergence(policy, reference):
    """Вычислите KL(policy || reference) для двух распределений.

    Нулевая вероятность policy не вносит вклад. Если policy положительна,
    а reference равна нулю, верните бесконечность.
    """
    raise NotImplementedError


def rlhf_objective(policy, reference, rewards, beta):
    """Вычислите ожидаемую награду за вычетом beta * KL до SFT-якоря.

    Распределения и список наград должны иметь одинаковую длину.
    Отрицательное beta должно приводить к ValueError.
    """
    raise NotImplementedError


def kl_anchored_policy(reference, rewards, beta):
    """Перевзвесьте SFT-распределение наградами при положительном beta.

    Меньшее beta должно сильнее сдвигать вероятность к действию
    с высокой наградой. Пустой ввод должен возвращать пустой список.
    """
    raise NotImplementedError


def alignment_tax(before_scores, after_scores):
    """Верните среднее падение бенчмарков после RLHF.

    Отрицательный результат означает улучшение. Для пустых списков
    верните 0.0, а при разной длине списков вызовите ValueError.
    """
    raise NotImplementedError


def ppo_ptx_objective(rlhf_score, token_probabilities, gamma):
    """Добавьте к RLHF-оценке средний логарифм вероятностей предобучения.

    Пустой список не меняет оценку. Нулевая вероятность при положительном
    gamma даёт отрицательную бесконечность.
    """
    raise NotImplementedError
