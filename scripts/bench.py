#!/usr/bin/env python3
"""Сравнение exercise.py с solution.py. Печатает JSON в stdout.

    python3 scripts/bench.py <каталог-упражнения> [--fn transpose]

Метрики: строки, циклы, вложенность, ветвления по AST и медианное время одного
вызова в микросекундах на входах из bench.py упражнения. Рядом гоняется ruff
через uvx, если он есть.
"""

import argparse
import ast
import contextlib
import copy
import importlib.util
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

RUFF_SELECT = "E,F,W,B,C4,SIM,PERF,RUF"
# RUF001-003 ругаются на кириллицу в комментариях, E501 — на длину строки:
# в учебном коде это шум, а не находка.
RUFF_IGNORE = "RUF001,RUF002,RUF003,E501"


class FnMetrics(ast.NodeVisitor):
    def __init__(self):
        self.loops = 0
        self.branches = 0
        self.depth = 0
        self._cur = 0

    def _nest(self, node):
        self._cur += 1
        self.depth = max(self.depth, self._cur)
        self.generic_visit(node)
        self._cur -= 1

    def visit_For(self, node):
        self.loops += 1
        self._nest(node)

    def visit_While(self, node):
        self.loops += 1
        self._nest(node)

    def visit_comprehension(self, node):
        self.loops += 1
        self.generic_visit(node)

    def visit_If(self, node):
        self.branches += 1
        self._nest(node)

    def visit_IfExp(self, node):
        self.branches += 1
        self.generic_visit(node)

    def visit_BoolOp(self, node):
        self.branches += len(node.values) - 1
        self.generic_visit(node)


def measure(path):
    """{имя функции: метрики} по всем функциям верхнего уровня файла."""
    out = {}
    for node in ast.parse(path.read_text()).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        body = node.body
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            body = body[1:]
        lines = 0 if not body else body[-1].end_lineno - body[0].lineno + 1
        m = FnMetrics()
        for stmt in body:
            m.visit(stmt)
        out[node.name] = {
            "lines": lines,
            "loops": m.loops,
            "depth": m.depth,
            "branches": m.branches,
        }
    return out


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _timed_median(call, reps):
    """Медиана трёх серий по reps повторов call(). Общая для обоих путей ниже."""
    samples = []
    for _ in range(3):
        t0 = time.perf_counter()
        for _ in range(reps):
            call()
        samples.append((time.perf_counter() - t0) / reps * 1e6)
    return statistics.median(samples)


def _bench_pure(fn, args, budget):
    """Функция не трогает свои аргументы: один и тот же args безопасно
    переживает тысячи вызовов, секундомер меряет только сам вызов."""
    t0 = time.perf_counter()
    fn(*args)
    single = time.perf_counter() - t0
    reps = max(1, min(5000, int(budget / single) if single > 0 else 5000))
    return round(_timed_median(lambda: fn(*args), reps), 2)


def _bench_mutating(fn, args, budget):
    """Функция мутирует свои аргументы: каждый вызов обязан получить свежую
    копию, иначе второй вызов уже видит испорченные данные (M.pop() на
    списке, укороченном предыдущим вызовом, и так по кругу).

    Но copy.deepcopy сам по себе не бесплатен — на матрице 60x60 он стоит
    на порядок больше, чем сам вызов transpose. Если гонять его внутри
    секундомера, число в отчёте будет измерять в основном deepcopy, а не
    код учащегося, и разница с эталоном (у которого та же накладная
    расходность) смажется до незаметной. Поэтому копия при замере всё
    равно внутри таймера (иначе не бывает), но её медианная стоимость
    измеряется отдельно тем же способом и вычитается из результата —
    с полом в нуль, чтобы шум измерения не увёл разницу в минус.
    """
    t0 = time.perf_counter()
    fn(*copy.deepcopy(args))
    single = time.perf_counter() - t0
    reps = max(1, min(5000, int(budget / single) if single > 0 else 5000))

    with_copy = _timed_median(lambda: fn(*copy.deepcopy(args)), reps)
    copy_only = _timed_median(lambda: copy.deepcopy(args), reps)
    return round(max(with_copy - copy_only, 0.0), 2)


def bench(fn, args, budget=0.04):
    """Медиана времени одного вызова в микросекундах. None, если падает."""
    if fn is None or args is None:
        return None

    # Прогрев на свежей копии: если функция падает даже один раз, дальше
    # мерить нечего, а оригинал args ещё не тронут.
    probe = copy.deepcopy(args)
    try:
        fn(*probe)
    except Exception:
        return None

    try:
        mutates = probe != args
    except Exception:
        # Само сравнение упало (экзотический __eq__ у аргументов) —
        # считаем функцию мутирующей: это безопасная сторона, копия внутри
        # таймера не даст испортить данные для следующего вызова.
        mutates = True

    try:
        return _bench_mutating(fn, args, budget) if mutates else _bench_pure(fn, args, budget)
    except Exception:
        # Прогрев прошёл, но где-то в цикле повторов всё же случился сбой
        # (например, у мутирующей функции — на укороченном по кругу
        # списке). Функция не замерена — это status: "unknown", а не крах
        # всего отчёта.
        return None


def status(ratio):
    if ratio is None:
        return "unknown"
    if ratio <= 1.15:
        return "ok"
    return "slow" if ratio <= 2.0 else "very-slow"


def run_ruff(path):
    try:
        proc = subprocess.run(
            ["uvx", "ruff", "check", str(path), "--select", RUFF_SELECT,
             "--ignore", RUFF_IGNORE, "--output-format", "json", "--no-cache"],
            capture_output=True, text=True, timeout=120,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"available": False, "findings": []}

    # ruff печатает валидный JSON на stdout и когда находок нет (пустой
    # массив), и когда код завершения не 0 (нашёл проблемы — это код 1,
    # а не сбой). Различать «сломан» от «нашёл findings» нужно по тому,
    # разобрался ли stdout вообще, а не по коду возврата: пустой или не-JSON
    # stdout — это сломанный uvx/ruff, а не «чисто».
    try:
        raw = json.loads(proc.stdout) if proc.stdout.strip() else None
    except json.JSONDecodeError:
        raw = None

    if raw is None:
        return {"available": False, "findings": []}

    findings = [
        {
            "code": item.get("code") or "",
            "line": (item.get("location") or {}).get("row") or 0,
            "message": item.get("message") or "",
        }
        for item in raw
    ]
    return {"available": True, "findings": findings}


def load_lesson(lesson_dir, mine_path, ref_path):
    """AST-метрики и импорт exercise.py/solution.py/bench.py.

    Всё, что может кинуть SyntaxError/ImportError и что угодно ещё, живёт
    здесь и только здесь: main() ловит исключения именно из этой функции и
    превращает их в {"error": ...}. Самый частый случай — недописанная
    функция в exercise.py, то есть синтаксическая ошибка при ast.parse или
    при исполнении модуля.
    """
    mine_metrics, ref_metrics = measure(mine_path), measure(ref_path)

    # load() выполняет exercise.py/solution.py/bench.py как модули верхнего
    # уровня — сторонний print() на этом уровне не должен попасть на stdout
    # раньше нашего единственного JSON.
    with contextlib.redirect_stdout(sys.stderr):
        sys.path.insert(0, str(lesson_dir))
        mine_mod, ref_mod = load(mine_path, "_mine"), load(ref_path, "_ref")
        bench_file = lesson_dir / "bench.py"
        bench_spec = load(bench_file, "_bench").BENCH if bench_file.exists() else {}

    return mine_metrics, ref_metrics, mine_mod, ref_mod, bench_spec


def build_report(lesson_dir, mine_path, only_fn, mine_metrics, ref_metrics, mine_mod, ref_mod, bench_spec):
    """Собирает JSON из уже импортированных модулей.

    Импорт (load_lesson выше) уже прошёл успешно к этому моменту, а bench()
    гасит свои исключения сам (возвращает None вместо падения) — так что
    исключению отсюда вылезти наружу означало бы баг в самом скрипте, а не
    в коде учащегося. Поэтому здесь нет своего try/except с формулировкой
    "не удалось разобрать код" — такая ошибка тут была бы неверно адресована.
    """
    functions = []
    # bench() вызывает функции учащегося и эталона много раз; их print()
    # не должен попасть на stdout раньше нашего единственного JSON.
    with contextlib.redirect_stdout(sys.stderr):
        for name, ref_stats in ref_metrics.items():
            if only_fn and name != only_fn:
                continue
            call_args = bench_spec.get(name)
            t_mine = bench(getattr(mine_mod, name, None), call_args)
            t_ref = bench(getattr(ref_mod, name, None), call_args)
            ratio = round(t_mine / t_ref, 3) if (t_mine and t_ref) else None
            my_stats = mine_metrics.get(name)
            functions.append({
                "fn": name,
                "written": t_mine is not None,
                "mine": {**my_stats, "us": t_mine} if my_stats else None,
                "ref": {**ref_stats, "us": t_ref},
                "ratio": ratio,
                "status": status(ratio),
            })

    return {
        "exercise": lesson_dir.name,
        "functions": functions,
        "ruff": run_ruff(mine_path),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--fn", default=None)
    args = parser.parse_args()

    lesson_dir = Path(args.directory).resolve()
    mine_path = lesson_dir / "exercise.py"
    ref_path = lesson_dir / "solution.py"
    for path in (mine_path, ref_path):
        if not path.exists():
            print(json.dumps({"error": f"нет файла {path}"}), file=sys.stderr)
            sys.exit(2)

    try:
        mine_metrics, ref_metrics, mine_mod, ref_mod, bench_spec = load_lesson(
            lesson_dir, mine_path, ref_path,
        )
    except Exception as error:
        # Без этого перехвата скрипт падал бы трейсбеком без единой строки
        # JSON. Отдаём ту же форму ошибки, что и на отсутствующий файл:
        # JSON в stderr, ненулевой код возврата.
        print(json.dumps({"error": f"не удалось разобрать код: {error}"}), file=sys.stderr)
        sys.exit(2)

    report = build_report(
        lesson_dir, mine_path, args.fn, mine_metrics, ref_metrics, mine_mod, ref_mod, bench_spec,
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
