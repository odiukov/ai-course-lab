"""Moderation Systems OpenAI Perspective LlamaGuard.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменять.
"""


def collapse_openai_category(category: str) -> str:
    """Сведите одну из 13 категорий OpenAI к родительской категории.

    Подкатегории после символа "/" должны схлопываться в родительскую
    категорию. Для пустой или неизвестной категории вызовите ValueError.
    """
    raise NotImplementedError


def supports_image_moderation(category: str) -> bool:
    """Определите, поддерживает ли категория OpenAI проверку изображений.

    Считайте мультимодальными только точные категории violence, self-harm
    и sexual. Для пустой или неизвестной категории вызовите ValueError.
    """
    raise NotImplementedError


def perspective_action(score: float, threshold: float) -> str:
    """Примените порог к оценке токсичности в стиле Perspective API.

    Верните "hide", если score не меньше threshold, иначе "show".
    Обе величины должны находиться от 0 до 1 включительно; иначе ValueError.
    """
    raise NotImplementedError


def parallel_layer_latency(latencies_ms: list[float]) -> float:
    """Вычислите задержку параллельно запущенных классификаторов одного слоя.

    Верните задержку самого медленного классификатора, а для пустого списка
    верните 0. Отрицательная задержка должна приводить к ValueError.
    """
    raise NotImplementedError


def first_triggered_layer(
    input_flagged: bool,
    custom_flagged: bool,
    output_flagged: bool,
) -> str:
    """Верните первый сработавший слой стенда модерации.

    Проверяйте слои в порядке input, custom, output. Верните название слоя
    или "allow", если ни один слой не сработал.
    """
    raise NotImplementedError


def azure_migration_window_months(
    deprecated_year: int,
    deprecated_month: int,
    end_year: int,
    end_month: int,
) -> int:
    """Посчитайте число полных календарных месяцев окна миграции Azure.

    Месяцы должны быть от 1 до 12, годы — неотрицательными, а дата окончания
    не должна предшествовать дате объявления устаревания; иначе ValueError.
    """
    raise NotImplementedError
