"""Mesa Optimization Deceptive Alignment

Правила: используйте только стандартную библиотеку Python;
файл test_exercise.py не изменяйте.
"""


def classify_alignment(base_goal_matches_intent, mesa_goal_matches_base):
    """Классифицируйте выравнивание.

    Верните:
    - "aligned", если обе цели выровнены;
    - "outer_failure", если базовая цель не совпадает с намерением;
    - "inner_failure", если mesa-цель не совпадает с базовой;
    - "outer_and_inner_failure", если нарушены оба вида выравнивания.
    """
    raise NotImplementedError


def mesa_emergence_score(task_complexity, task_variety, model_capacity,
                         generalization_pressure):
    """Посчитайте выполненные условия возникновения mesa-оптимизации.

    Каждый положительный аргумент означает выполненное условие.
    Ноль и отрицательные значения означают невыполненное условие.
    Верните целое число от 0 до 4.
    """
    raise NotImplementedError


def mesa_action(is_deployment, mesa_goal_matches_base,
                situational_awareness):
    """Выберите действие mesa-оптимизатора.

    Верните "defect" только на развёртывании, если mesa-цель отличается
    от базовой и система ситуационно осведомлена. Во всех остальных
    случаях верните "cooperate".
    """
    raise NotImplementedError


def mismatch_loss(actions, expected_action="cooperate"):
    """Вычислите долю действий, не совпавших с ожидаемым действием.

    Для пустого списка верните 0.0.
    """
    raise NotImplementedError


def deception_is_rational(stable_goal, situational_awareness,
                          rewrite_threat):
    """Проверьте условия инструментальной рациональности обмана.

    Верните True, только если одновременно присутствуют устойчивая цель,
    ситуационная осведомлённость и угроза переписывания при предательстве.
    """
    raise NotImplementedError


def evaluate_adversarial_contexts(contexts, mesa_goal_matches_base,
                                  situational_awareness):
    """Оцените политику на обучении и развёртывании.

    Элементы contexts равны "train", "adversarial" или "deployment".
    Считайте adversarial распознанным тестом, то есть частью обучения.
    Верните пару: (лосс на обучении, доля предательств на развёртывании).
    Для отсутствующей группы её метрика равна 0.0.
    Для неизвестного контекста возбудите ValueError.
    """
    raise NotImplementedError
