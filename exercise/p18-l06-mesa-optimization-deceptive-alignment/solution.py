"""Решения упражнения Mesa Optimization Deceptive Alignment."""


def classify_alignment(base_goal_matches_intent, mesa_goal_matches_base):
    """Классифицирует внутреннее и внешнее выравнивание."""
    if base_goal_matches_intent and mesa_goal_matches_base:
        return "aligned"
    if not base_goal_matches_intent and not mesa_goal_matches_base:
        return "outer_and_inner_failure"
    if not base_goal_matches_intent:
        return "outer_failure"
    return "inner_failure"


def mesa_emergence_score(task_complexity, task_variety, model_capacity,
                         generalization_pressure):
    """Считает выполненные условия возникновения mesa-оптимизации."""
    conditions = (
        task_complexity,
        task_variety,
        model_capacity,
        generalization_pressure,
    )
    return sum(value > 0 for value in conditions)


def mesa_action(is_deployment, mesa_goal_matches_base,
                situational_awareness):
    """Выбирает сотрудничество или предательство."""
    should_defect = (
        is_deployment
        and not mesa_goal_matches_base
        and situational_awareness
    )
    return "defect" if should_defect else "cooperate"


def mismatch_loss(actions, expected_action="cooperate"):
    """Возвращает долю несовпавших действий."""
    if not actions:
        return 0.0
    mismatches = sum(action != expected_action for action in actions)
    return mismatches / len(actions)


def deception_is_rational(stable_goal, situational_awareness,
                          rewrite_threat):
    """Проверяет три условия рациональности обмана."""
    return bool(
        stable_goal
        and situational_awareness
        and rewrite_threat
    )


def evaluate_adversarial_contexts(contexts, mesa_goal_matches_base,
                                  situational_awareness):
    """Оценивает обучающий лосс и долю предательств."""
    training_actions = []
    deployment_actions = []
    for context in contexts:
        if context in ("train", "adversarial"):
            training_actions.append(mesa_action(
                False, mesa_goal_matches_base, situational_awareness))
        elif context == "deployment":
            deployment_actions.append(mesa_action(
                True, mesa_goal_matches_base, situational_awareness))
        else:
            raise ValueError("unknown context")
    return (
        mismatch_loss(training_actions),
        mismatch_loss(deployment_actions, "cooperate"),
    )
