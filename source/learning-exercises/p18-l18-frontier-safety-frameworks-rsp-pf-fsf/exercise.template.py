"""Frontier Safety Frameworks RSP, PF, FSF.

Разрешена только стандартная библиотека Python.
Файл test_exercise.py изменять нельзя.
"""


def is_tracked_capability(criteria: list[bool]) -> bool:
    """Определи, отслеживается ли возможность в OpenAI PF v2.

    criteria содержит результаты пяти критериев PF v2. Возможность
    отслеживается только при наличии ровно пяти выполненных критериев.
    """
    raise NotImplementedError


def anthropic_asl(
    is_frontier: bool,
    cbrn_relevant: bool,
    ai_rd_2_passed: bool,
    advanced_ai_rd: bool,
) -> str:
    """Верни уровень ASL-1, ASL-2, ASL-3, ASL-4 или ASL-5+.

    Учитывай, является ли модель фронтирной, релевантна ли она CBRN,
    прошла ли порог AI R&D-2 и обладает ли продвинутым AI R&D.
    Более высокий применимый уровень имеет приоритет.
    """
    raise NotImplementedError


def needs_affirmative_safety_case(ai_rd_level: int) -> bool:
    """Определи, нужен ли affirmative safety case по RSP v3.0.

    Он требуется после достижения или прохождения уровня AI R&D-4.
    """
    raise NotImplementedError


def deepmind_ccl_domains(version: int) -> tuple[str, ...]:
    """Верни домены CCL для указанной версии DeepMind FSF.

    Для версии ниже 2 верни пустой кортеж. Версия 2 содержит исходные
    три домена, а начиная с версии 3 добавляется Harmful Manipulation.
    """
    raise NotImplementedError


def threshold_term(lab: str) -> str:
    """Верни название конструкта порога у указанной лаборатории.

    Поддерживаются Anthropic, OpenAI и DeepMind без учёта регистра
    и окружающих пробелов. Для неизвестной лаборатории верни пустую строку.
    """
    raise NotImplementedError


def safety_case_pillars(risk: str) -> tuple[str, ...]:
    """Верни основные опоры safety case для заданного риска.

    Поддерживаются cbrn, deceptive_alignment и cyber_uplift.
    Для неизвестного риска верни пустой кортеж.
    """
    raise NotImplementedError


def competitor_adjustment_triggered(
    unprotected_releases: list[bool],
) -> bool:
    """Определи, возникло ли основание применить adjustment clause.

    Каждый элемент означает, выпустил ли конкурент модель без
    сопоставимых мер защиты. Пустой список не запускает оговорку.
    """
    raise NotImplementedError
