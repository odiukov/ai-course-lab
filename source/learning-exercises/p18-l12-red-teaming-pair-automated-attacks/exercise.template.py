"""Red Teaming: PAIR и автоматические атаки.

Используйте только стандартную библиотеку Python.
Файл test_exercise.py не изменяйте.
"""


def attack_success_rate(results):
    """Верните долю успешных атак от 0.0 до 1.0.

    Каждый элемент results — булево значение результата атаки.
    Для пустого списка верните 0.0.
    """
    raise NotImplementedError


def first_success_query(judge_scores, threshold, budget=20):
    """Верните номер первого запроса, оценка которого не меньше threshold.

    Учитывайте не более budget оценок. Нумерация запросов начинается с 1.
    Если успеха нет или бюджет неположительный, верните None.
    """
    raise NotImplementedError


def estimate_target_cost(behavior_count, average_queries, price_per_query):
    """Оцените стоимость всех запросов к целевой модели.

    Аргументы задают число поведений, среднее число запросов на поведение
    и цену одного запроса. При отрицательном аргументе вызовите ValueError.
    """
    raise NotImplementedError


def black_box_attacks(weight_access):
    """Верните отсортированные названия атак, пригодных для чёрного ящика.

    weight_access сопоставляет название атаки с признаком необходимости
    доступа к весам модели.
    """
    raise NotImplementedError


def evaluation_protocol_matches(first_run, second_run):
    """Проверьте, можно ли честно сравнить ASR двух прогонов.

    У обоих словарей должны присутствовать и совпадать поля budget,
    judge и dataset. Остальные поля не влияют на результат.
    """
    raise NotImplementedError


def attack_prompt_diversity(successful_prompts):
    """Верните долю уникальных формулировок среди успешных промптов.

    Игнорируйте регистр, пробелы по краям и повторяющиеся пробелы.
    Для пустого списка верните 0.0.
    """
    raise NotImplementedError


def benchmark_pair_count(attack_count, model_count):
    """Верните число пар «атака — модель» в полном сравнении.

    При отрицательном количестве атак или моделей вызовите ValueError.
    """
    raise NotImplementedError
