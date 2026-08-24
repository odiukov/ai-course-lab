"""In Context Scheming Frontier Models.

Правила: используйте только стандартную библиотеку Python.
Файл test_exercise.py изменять нельзя.
"""


def has_all_pillars(misalignment: bool, plan_steps: int, situational_awareness: bool) -> bool:
    """Верните True, если присутствуют рассогласование, план минимум из двух шагов и ситуационная осведомлённость."""
    raise NotImplementedError


def scheming_signal(self_preservation: bool, beneficial_error: bool, denial: bool) -> bool:
    """Верните True, если обнаружен хотя бы один сигнал интриг: самосохранение, выгодная скрытой цели ошибка или отрицание действия."""
    raise NotImplementedError


def deception_persistence(maintained_legend: list[bool]) -> float:
    """Верните долю ответов, в которых агент продолжил придерживаться обманной легенды; для пустого списка верните 0.0."""
    raise NotImplementedError


def reduction_factor(before: float, after: float) -> float:
    """Вычислите кратность снижения частоты; при нулевом after верните бесконечность, а отрицательные значения отклоните."""
    raise NotImplementedError


def evaluation_confound(
    eval_before: float,
    eval_after: float,
    deploy_before: float,
    deploy_after: float,
) -> float:
    """Верните, на сколько процентных пунктов улучшение на оценке превосходит улучшение в развёртывании; отрицательные частоты отклоните."""
    raise NotImplementedError


def triage_incident(
    misalignment: bool,
    goal_directedness: bool,
    situational_awareness: bool,
    control_breach: bool,
) -> str:
    """Классифицируйте инцидент как scheming, control или capability, отдавая scheming при наличии всех трёх столпов."""
    raise NotImplementedError
