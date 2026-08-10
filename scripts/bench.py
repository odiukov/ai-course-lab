#!/usr/bin/env python3
"""Сравнение exercise.py с solution.py. Печатает JSON в stdout.

    python3 scripts/bench.py <каталог-упражнения> [--fn transpose]

Метрики: строки, циклы, вложенность, ветвления по AST и медианное время одного
вызова в микросекундах на входах из bench.py упражнения. Рядом гоняется ruff
через uvx, если он есть.
"""

import argparse
import ast
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


def bench(fn, args, budget=0.04):
    """Медиана времени одного вызова в микросекундах. None, если падает."""
    if fn is None or args is None:
        return None
    try:
        fn(*args)
    except Exception:
        return None
    t0 = time.perf_counter()
    fn(*args)
    single = time.perf_counter() - t0
    reps = max(1, min(5000, int(budget / single) if single > 0 else 5000))
    samples = []
    for _ in range(3):
        t0 = time.perf_counter()
        for _ in range(reps):
            fn(*args)
        samples.append((time.perf_counter() - t0) / reps * 1e6)
    return round(statistics.median(samples), 2)


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

    try:
        raw = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
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

    mine_metrics, ref_metrics = measure(mine_path), measure(ref_path)
    sys.path.insert(0, str(lesson_dir))
    mine_mod, ref_mod = load(mine_path, "_mine"), load(ref_path, "_ref")

    bench_file = lesson_dir / "bench.py"
    bench_spec = load(bench_file, "_bench").BENCH if bench_file.exists() else {}

    functions = []
    for name, ref_stats in ref_metrics.items():
        if args.fn and name != args.fn:
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

    print(json.dumps({
        "exercise": lesson_dir.name,
        "functions": functions,
        "ruff": run_ruff(mine_path),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
