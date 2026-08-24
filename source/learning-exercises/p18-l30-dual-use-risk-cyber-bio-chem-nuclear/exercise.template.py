"""Dual Use Risk Cyber Bio Chem Nuclear.

Правила: используй только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def uplifted_score(baseline, multiplier):
    """Верни итоговый балл после uplift.

    baseline и multiplier должны быть неотрицательными.
    При нарушении условия подними ValueError.
    """
    raise NotImplementedError


def automated_campaign_percent(total_steps, human_steps):
    """Верни процент шагов кампании, выполненных автоматически.

    total_steps должен быть положительным, а human_steps — находиться
    от нуля до total_steps включительно. Иначе подними ValueError.
    """
    raise NotImplementedError


def attempts_after_optimization(original_attempts, efficiency_factor):
    """Оцени число попыток после повышения эффективности.

    original_attempts должен быть неотрицательным, efficiency_factor —
    положительным. При неверных данных подними ValueError.
    """
    raise NotImplementedError


def bottleneck_capability(information_capability, physical_access):
    """Верни практическую возможность системы с двумя узкими местами.

    Результат ограничен более слабым из факторов: информационными
    возможностями или физическим доступом. Отрицательные значения запрещены.
    """
    raise NotImplementedError


def asymmetry_metrics(novice_before, novice_after, expert_before, expert_after):
    """Верни пару: относительный uplift новичка и абсолютный прирост эксперта.

    Все показатели должны быть неотрицательными, novice_before — больше нуля,
    а показатели после помощи не должны быть ниже исходных. Иначе подними
    ValueError.
    """
    raise NotImplementedError


def triage_domains(claim):
    """Найди домены риска в тексте заявления.

    Верни кортеж из bio, chem, cyber и nuclear в этом порядке.
    Поиск должен игнорировать регистр, а домены не должны повторяться.
    """
    raise NotImplementedError


def risk_scope(affects_novice, affects_expert):
    """Определи, чьи возможности затрагивает риск.

    Верни novice-relative, expert-absolute, both или neither в зависимости
    от двух логических флагов.
    """
    raise NotImplementedError
