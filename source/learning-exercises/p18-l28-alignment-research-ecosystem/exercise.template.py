"""Урок: Alignment Research Ecosystem.

Правила:
- Используйте только стандартную библиотеку Python.
- Не изменяйте файл test_exercise.py.
"""


def publication_rate(papers: int, researchers: int) -> float:
    """Верните среднее число статей на одного исследователя.

    Если исследователей нет, верните 0.0.
    Для отрицательных аргументов вызовите ValueError.
    """
    raise NotImplementedError


def h_index(citations: list[int]) -> int:
    """Вычислите h-индекс по списку чисел цитирований статей.

    h-индекс равен максимальному h, при котором хотя бы h статей имеют
    не менее h цитирований каждая. Пустой список даёт 0.
    Для отрицательного числа цитирований вызовите ValueError.
    """
    raise NotImplementedError


def identify_organization(method: str) -> str:
    """Определите организацию по описанию её методологического стиля.

    Сопоставьте упоминания менторства с MATS, худшего случая с
    Redwood Research, схемящего поведения с Apollo Research,
    временного горизонта с METR и благополучия модели с Eleos AI Research.
    Регистр и пробелы по краям не важны. Если совпадения нет,
    верните строку "Неизвестно".
    """
    raise NotImplementedError


def is_external_evaluation(model_creator: str, evaluator: str) -> bool:
    """Верните True, если создатель модели и оценщик — разные организации.

    Сравнивайте названия без учёта регистра и пробелов по краям.
    Если хотя бы одно название пустое, верните False.
    """
    raise NotImplementedError


def task_horizon(completed_task_minutes: list[float]) -> float:
    """Верните временной горизонт модели в минутах.

    Горизонт равен длительности самой длинной завершённой моделью задачи.
    Для пустого списка верните 0.0. Если длительность отрицательна,
    вызовите ValueError.
    """
    raise NotImplementedError


def can_scheme(
    misaligned: bool,
    goal_directed: bool,
    situation_aware: bool,
) -> bool:
    """Проверьте, может ли модель проявлять схемящее поведение.

    Оно возможно, только если одновременно присутствуют рассогласование,
    целенаправленность и ситуационная осведомлённость.
    """
    raise NotImplementedError
