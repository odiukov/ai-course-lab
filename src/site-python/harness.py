"""Прогон тестов упражнения внутри браузера.

Файл целиком уезжает в сборку и исполняется в Pyodide. Здесь две вещи:
заменитель pytest и сам прогонщик.

Заменитель, а не настоящий pytest, потому что упражнения курса используют из
него ровно три вещи — approx, raises и один parametrize, — а установка пакета
означала бы поход в сеть на каждой странице с практикой. Стандартной
библиотеки Pyodide хватает на все упражнения: numpy и прочего в них нет.
"""

import inspect
import json
import math
import os
import re
import sys
import traceback
import types

# Значения по умолчанию у pytest.approx.
DEFAULT_REL = 1e-6
DEFAULT_ABS = 1e-12


class Approx:
    """Сравнение чисел с допуском, включая списки, кортежи и словари.

    Правило допуска — как в pytest: заданный только abs означает абсолютный
    допуск, заданный только rel — относительный, ничего не задано — большее из
    двух умолчаний.
    """

    def __init__(self, expected, rel=None, abs=None):
        self.expected = expected
        self.rel = rel
        self.abs = abs

    def _close(self, actual, expected):
        if isinstance(expected, (list, tuple)):
            if not isinstance(actual, (list, tuple)) or len(actual) != len(expected):
                return False
            return all(self._close(a, e) for a, e in zip(actual, expected))

        if isinstance(expected, dict):
            if not isinstance(actual, dict) or set(actual) != set(expected):
                return False
            return all(self._close(actual[key], expected[key]) for key in expected)

        if isinstance(expected, bool) or isinstance(actual, bool):
            return actual == expected

        if not isinstance(actual, (int, float)) or not isinstance(expected, (int, float)):
            return actual == expected

        if math.isnan(expected) or math.isnan(actual):
            return math.isnan(expected) and math.isnan(actual)

        if self.abs is not None and self.rel is None:
            tolerance = self.abs
        elif self.rel is not None and self.abs is None:
            tolerance = self.rel * abs(expected)
        elif self.rel is not None and self.abs is not None:
            tolerance = max(self.rel * abs(expected), self.abs)
        else:
            tolerance = max(DEFAULT_REL * abs(expected), DEFAULT_ABS)

        return abs(actual - expected) <= tolerance

    def __eq__(self, other):
        return self._close(other, self.expected)

    def __repr__(self):
        return "approx({!r})".format(self.expected)


class ExceptionInfo:
    def __init__(self):
        self.value = None
        self.type = None


class RaisesContext:
    def __init__(self, expected, match=None):
        self.expected = expected
        self.match = match
        self.info = ExceptionInfo()

    def __enter__(self):
        return self.info

    def __exit__(self, exc_type, exc_value, tb):
        if exc_type is None:
            raise AssertionError("DID NOT RAISE {}".format(self.expected))
        if not issubclass(exc_type, self.expected):
            return False

        self.info.value = exc_value
        self.info.type = exc_type
        if self.match is not None and not re.search(self.match, str(exc_value)):
            raise AssertionError(
                "текст ошибки {!r} не совпал с {!r}".format(str(exc_value), self.match)
            )
        return True


def _parametrize(argnames, argvalues, **kwargs):
    """Разворачивает набор случаев в один вызов.

    Настоящий pytest сделал бы из каждого случая отдельный тест; здесь важнее,
    что упадёт хотя бы один, и упадёт с понятным сообщением.
    """

    names = [name.strip() for name in argnames.split(",")]

    def decorate(function):
        def wrapper():
            for values in argvalues:
                case = values if isinstance(values, (list, tuple)) else (values,)
                try:
                    function(*case)
                except AssertionError as error:
                    raise AssertionError("случай {!r}: {}".format(case, error))

        wrapper.__name__ = function.__name__
        return wrapper

    return decorate


def _fixture(function=None, autouse=False, **kwargs):
    """Помечает функцию фикстурой.

    Работает в обеих формах записи — и `@pytest.fixture`, и `@pytest.fixture()`.
    Значение потом подставит прогонщик: он смотрит, какие аргументы просит тест.

    `autouse=True` означает «отработать перед каждым тестом, даже если никто не
    просил»: такими обычно чистят общее состояние между тестами, и без них
    тесты начинают видеть следы соседей.
    """

    def mark(target):
        target._is_fixture = True
        target._autouse = bool(autouse)
        return target

    return mark(function) if function is not None else mark


def run_autouse(module):
    """Отрабатывает фикстуры, которые просят звать их всегда."""

    started = []
    for name in dir(module):
        source = getattr(module, name, None)
        if not getattr(source, "_is_fixture", False) or not getattr(source, "_autouse", False):
            continue
        produced = source()
        if inspect.isgenerator(produced):
            started.append(produced)
            next(produced)
    return started


def resolve_fixtures(module, test):
    """Значения аргументов теста: каждый берётся у одноимённой фикстуры.

    Фикстура с yield отдаёт значение и хочет доработать после теста — такие
    возвращаются вторым списком, чтобы прогонщик их закрыл.
    """

    values = []
    started = []
    for name in inspect.signature(test).parameters:
        source = getattr(module, name, None)
        if source is None or not getattr(source, "_is_fixture", False):
            raise AssertionError("тест просит фикстуру {!r}, которой нет".format(name))

        produced = source()
        if inspect.isgenerator(produced):
            started.append(produced)
            values.append(next(produced))
        else:
            values.append(produced)

    return values, started


def install_pytest_stub():
    module = types.ModuleType("pytest")
    module.approx = lambda expected, rel=None, abs=None: Approx(expected, rel, abs)
    module.raises = lambda expected, match=None: RaisesContext(expected, match)
    module.fail = lambda message="": (_ for _ in ()).throw(AssertionError(message))
    module.fixture = _fixture

    mark = types.SimpleNamespace(parametrize=_parametrize)
    module.mark = mark
    sys.modules["pytest"] = module


def select_tests(names, fn, functions):
    """Тесты шага: те, что про его функцию, и только они.

    Правило то же, что у фильтра `pytest -k` в локальном приложении: имя
    функции И НЕ любое из остальных имён упражнения. Одного имени мало —
    `identity` подстрокой сидит в `test_matmul_by_identity_changes_nothing`,
    который зовёт ещё не написанный `matmul` и красит шаг за чужую заготовку.
    Имена, которые сами являются подстрокой fn, из отрицания выкидываются,
    иначе они обнулили бы весь отбор.
    """

    others = [name for name in dict.fromkeys(functions) if name != fn and name not in fn]
    chosen = [
        name for name in names if fn in name and not any(other in name for other in others)
    ]
    return chosen


def run(code, fn, functions, workdir="/exercise"):
    """Пишет код учащегося на диск и гоняет по нему тесты упражнения.

    Каталог — аргумент, чтобы прогонщик можно было проверить обычным Python,
    а не только внутри браузера.
    """

    with open(os.path.join(workdir, "exercise.py"), "w") as handle:
        handle.write(code)

    install_pytest_stub()
    for name in ("exercise", "test_exercise"):
        sys.modules.pop(name, None)

    if workdir not in sys.path:
        sys.path.insert(0, workdir)

    try:
        module = __import__("test_exercise")
    except Exception as error:  # noqa: BLE001 — учащемуся важна причина, любая
        return json.dumps(
            {
                "loadError": "".join(
                    traceback.format_exception_only(type(error), error)
                ).strip(),
                "results": [],
                "filtered": False,
            }
        )

    names = [name for name in dir(module) if name.startswith("test_")]
    names.sort()
    chosen = select_tests(names, fn, functions) if fn else names
    # Пустой отбор — не повод молчать: гоняем весь файл и говорим об этом.
    # Зелёный вердикт по случайно совпавшему тесту хуже честного «прогнали всё».
    filtered = len(chosen) > 0
    if not filtered:
        chosen = names

    results = []
    for name in chosen:
        test = getattr(module, name)
        if not callable(test):
            continue
        try:
            started = run_autouse(module)
            values, requested = resolve_fixtures(module, test)
            started.extend(requested)
            try:
                test(*values)
            finally:
                for generator in started:
                    generator.close()
            results.append({"name": name, "passed": True, "message": ""})
        except Exception as error:  # noqa: BLE001 — падение теста это результат
            message = "".join(traceback.format_exception_only(type(error), error)).strip()
            results.append({"name": name, "passed": False, "message": message})

    return json.dumps({"loadError": None, "results": results, "filtered": filtered})


def run_json(payload):
    """Вход и выход одной строкой JSON.

    Так браузерная сторона не зависит от того, как Pyodide преобразует
    массивы и словари между языками: строка есть строка.
    """

    request = json.loads(payload)
    return run(request["code"], request.get("fn"), request.get("functions") or [])
