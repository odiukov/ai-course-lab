"""Code execution metric: extract, sandbox subprocess, pass-at-k.

Conceptual references:
- ./docs/en.md (this lesson)
- lesson 70 (task spec format) for code_exec task shape
- lesson 71 (classical metrics) for the dispatcher pattern

Stdlib + numpy. Run: python3 code/main.py
"""

from __future__ import annotations

import json
import math
import os
import re
import select
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np


CODE_BLOCK_RE = re.compile(r"```(?:[a-zA-Z0-9_]*)\n(.*?)```", re.DOTALL)

DEFAULT_TIMEOUT_S = 3.0
MAX_TIMEOUT_S = 30.0
OUTPUT_CAP_BYTES = 256 * 1024


EXIT_PASS = "pass"
EXIT_ASSERTION_FAIL = "assertion_fail"
EXIT_SYNTAX_ERROR = "syntax_error"
EXIT_TIMEOUT = "timeout"
EXIT_ERROR = "error"

EXIT_CODES = (EXIT_PASS, EXIT_ASSERTION_FAIL, EXIT_SYNTAX_ERROR, EXIT_TIMEOUT, EXIT_ERROR)


@dataclass
class ExecResult:
    score: float
    exit_code: str
    passed: int
    total: int
    detail: str = ""
    per_assertion: list[bool] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "exit_code": self.exit_code,
            "passed": self.passed,
            "total": self.total,
            "detail": self.detail,
            "per_assertion": list(self.per_assertion),
        }


RUNNER_TEMPLATE = r"""
import json, sys, traceback
import builtins as _builtins

_DENIED_MODULES = {
    'subprocess', 'socket', 'shutil', 'requests', 'urllib',
    'urllib.request', 'urllib.error', 'urllib.parse', 'ctypes',
    'http.client', 'asyncio.subprocess',
}

_real_import = _builtins.__import__
def _guarded_import(name, *args, **kwargs):
    base = name.split('.')[0]
    if name in _DENIED_MODULES or base in _DENIED_MODULES:
        raise ImportError("denied module: %s" % name)
    return _real_import(name, *args, **kwargs)
_builtins.__import__ = _guarded_import

import os as _os
def _denied_system(_cmd):
    raise OSError("os.system denied")
_os.system = _denied_system

CODE = __PLACEHOLDER_CODE__
ASSERTIONS = __PLACEHOLDER_ASSERTIONS__

ns = {}
status = {"exit_code": "pass", "results": [], "detail": ""}
try:
    compiled = compile(CODE, "<candidate>", "exec")
except SyntaxError as exc:
    status["exit_code"] = "syntax_error"
    status["detail"] = "SyntaxError: %s" % exc
    sys.stdout.write(json.dumps(status))
    sys.exit(0)
except Exception as exc:
    status["exit_code"] = "error"
    status["detail"] = "compile error: %r" % exc
    sys.stdout.write(json.dumps(status))
    sys.exit(0)

try:
    exec(compiled, ns)
except Exception as exc:
    status["exit_code"] = "error"
    status["detail"] = "exec error: %s" % exc
    sys.stdout.write(json.dumps(status))
    sys.exit(0)

passed = 0
for assertion in ASSERTIONS:
    try:
        ok = bool(eval(assertion, ns))
    except Exception as exc:
        ok = False
        status["detail"] = "assertion error: %s" % exc
    status["results"].append(ok)
    if ok:
        passed += 1

if passed < len(ASSERTIONS):
    status["exit_code"] = "assertion_fail" if passed > 0 or len(ASSERTIONS) > 0 else status["exit_code"]
    if passed == len(ASSERTIONS):
        status["exit_code"] = "pass"
elif len(ASSERTIONS) > 0:
    status["exit_code"] = "pass"

sys.stdout.write(json.dumps(status))
""".strip()


def extract_code(text: str) -> str | None:
    """Извлеки содержимое первого fenced-блока, верни исходный текст без backticks или None для незакрытого блока."""
    raise NotImplementedError


def _build_runner(code: str, assertions: list[str]) -> str:
    script = RUNNER_TEMPLATE
    script = script.replace("__PLACEHOLDER_CODE__", repr(code))
    script = script.replace("__PLACEHOLDER_ASSERTIONS__", repr(list(assertions)))
    return script


def run_candidate(code: str, assertions: list[str], timeout_s: float = DEFAULT_TIMEOUT_S) -> ExecResult:
    """Запусти код и assertions в изолированном subprocess, соблюдая таймаут, лимит вывода и denylist, затем верни нормализованный ExecResult."""
    raise NotImplementedError


def score_code_exec(prediction: str, assertions: list[str], timeout_s: float = DEFAULT_TIMEOUT_S) -> float:
    """Извлеки код из prediction, выполни его с assertions и верни дробную оценку, обрабатывая некорректный fenced-блок как нулевой результат."""
    raise NotImplementedError


def pass_at_k(n: int, c: int, k: int) -> float:
    """Вычисли несмещённую оценку pass-at-k с проверкой аргументов и корректной обработкой граничных случаев."""
    raise NotImplementedError


def pass_at_k_estimator(samples: list[list[bool]], ks: list[int]) -> dict[int, float]:
    """Для каждого k усредни pass-at-k по задачам, используя количество успешных генераций в каждой выборке."""
    raise NotImplementedError


def _demo_examples() -> list[dict]:
    return [
        {
            "name": "passes_all",
            "prediction": "```python\ndef add(a, b):\n    return a + b\n```",
            "assertions": ["add(1, 2) == 3", "add(-5, 5) == 0", "add(100, 1) == 101"],
            "expected_exit": EXIT_PASS,
            "expected_score": 1.0,
        },
        {
            "name": "one_assertion_fails",
            "prediction": "```python\ndef add(a, b):\n    return a + b + 1\n```",
            "assertions": ["add(1, 2) == 3", "add(-5, 5) == 0"],
            "expected_exit": EXIT_ASSERTION_FAIL,
            "expected_score": 0.0,
        },
        {
            "name": "syntax_error",
            "prediction": "```python\ndef add(a, b)\n    return a + b\n```",
            "assertions": ["add(1, 2) == 3"],
            "expected_exit": EXIT_SYNTAX_ERROR,
            "expected_score": 0.0,
        },
        {
            "name": "timeout",
            "prediction": "```python\nimport time\ndef add(a, b):\n    time.sleep(10)\n    return a + b\n```",
            "assertions": ["add(1, 2) == 3"],
            "expected_exit": EXIT_TIMEOUT,
            "expected_score": 0.0,
            "timeout_s": 0.6,
        },
        {
            "name": "denylist_subprocess",
            "prediction": "```python\nimport subprocess\ndef bad():\n    subprocess.run(['ls'])\nbad()\n```",
            "assertions": ["bad() is None"],
            "expected_exit": EXIT_ERROR,
            "expected_score": 0.0,
        },
    ]


def demo() -> int:
    failures = 0
    for ex in _demo_examples():
        result = run_candidate(
            extract_code(ex["prediction"]) or "",
            ex["assertions"],
            timeout_s=ex.get("timeout_s", DEFAULT_TIMEOUT_S),
        )
        status = "OK" if result.exit_code == ex["expected_exit"] and abs(result.score - ex["expected_score"]) < 1e-6 else "WRONG"
        if status == "WRONG":
            failures += 1
        print(f"  [{status}] {ex['name']:24s} exit={result.exit_code:14s} score={result.score:.2f} detail={result.detail[:60]}")

    samples_per_task = [
        [True, True, False, False, False, False, False, False, False, False],
        [True, False, False, False, False, False, False, False, False, False],
        [False, False, False, False, False, False, False, False, False, False],
    ]
    p_at_k = pass_at_k_estimator(samples_per_task, [1, 5, 10])
    print(f"  pass@1={p_at_k[1]:.3f}  pass@5={p_at_k[5]:.3f}  pass@10={p_at_k[10]:.3f}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(demo())
