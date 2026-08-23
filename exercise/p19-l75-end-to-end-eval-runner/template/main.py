"""End-to-end eval runner: tasks -> adapter -> metric -> calibration -> leaderboard.

Conceptual references:
- ./docs/en.md (this lesson)
- lesson 70 (task spec), 71 (metrics), 72 (code exec), 73 (calibration), 74 (leaderboard)

Stdlib + numpy. Run: python3 code/main.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Sequence


def _load_sibling(lesson_dir: str, module_name: str = "main"):
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.join(here, "_resources")
    if not os.path.isdir(root):
        root = os.path.normpath(os.path.join(here, "..", ".."))
    sibling = os.path.join(root, lesson_dir, "code", "main.py")
    if not os.path.isfile(sibling):
        raise ImportError(f"sibling module not found: {sibling}")
    mod_name = f"_sibling_{lesson_dir.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(mod_name, sibling)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build spec for {sibling}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


spec_mod = _load_sibling("70-task-spec-format")
metrics_mod = _load_sibling("71-classical-metrics")
exec_mod = _load_sibling("72-code-exec-metric")
calib_mod = _load_sibling("73-perplexity-calibration")
board_mod = _load_sibling("74-leaderboard-aggregation")


TaskSpec = spec_mod.TaskSpec


@dataclass
class Generation:
    text: str
    confidence: float = 0.5
    token_nll: float = 0.0
    token_count: int = 0


class ModelAdapter:
    model_id: str = "abstract"

    def generate(self, prompt: str, task: TaskSpec) -> Generation:
        raise NotImplementedError


@dataclass
class TaskResult:
    model_id: str
    task_id: str
    category: str
    metric_name: str
    score: float
    correct: bool
    confidence: float
    generation: str
    detail: str = ""
    wall_seconds: float = 0.0


@dataclass
class EvalReport:
    leaderboard: list[dict]
    pairwise: list[dict]
    calibration: dict[str, dict]
    perplexity: dict[str, dict]
    summary: dict
    error: str | None = None

    def to_json(self) -> str:
        payload = {
            "leaderboard": self.leaderboard,
            "pairwise": self.pairwise,
            "calibration": self.calibration,
            "perplexity": self.perplexity,
            "summary": self.summary,
        }
        if self.error:
            payload["error"] = self.error
        return json.dumps(payload, indent=2)


def _correct_from_score(metric_name: str, score: float, threshold: float = 0.5) -> bool:
    """Преобразуй значение метрики в признак правильного ответа с учётом направления метрики и заданного порога."""
    raise NotImplementedError


def _score_one(adapter: ModelAdapter, task: TaskSpec, timeout_s: float = 3.0) -> TaskResult:
    rendered = spec_mod.render_prompt(task)
    t0 = time.time()
    gen = adapter.generate(rendered, task)
    elapsed = time.time() - t0
    processed = spec_mod.post_process(gen.text, task.post_process)
    if task.metric_name == "code_exec":
        result = exec_mod.run_candidate(
            exec_mod.extract_code(processed) or processed,
            task.targets,
            timeout_s=timeout_s,
        )
        score = result.score
        detail = result.detail
    else:
        score = metrics_mod.score(task.metric_name, processed, task.targets)
        detail = ""
    correct = _correct_from_score(task.metric_name, score)
    return TaskResult(
        model_id=adapter.model_id,
        task_id=task.task_id,
        category=task.category,
        metric_name=task.metric_name,
        score=float(score),
        correct=bool(correct),
        confidence=float(min(1.0, max(0.0, gen.confidence))),
        generation=gen.text,
        detail=detail,
        wall_seconds=float(elapsed),
    )


def run_eval(
    adapters: Sequence[ModelAdapter],
    tasks: Sequence[TaskSpec],
    parallel: bool = True,
    max_workers: int = 8,
    code_exec_timeout_s: float = 3.0,
) -> tuple[list[TaskResult], dict[str, list[tuple[float, float, int]]]]:
    """Выполни все пары модель-задача последовательно или в пуле, сохрани детерминированный порядок и собери буфер для калибровки."""
    raise NotImplementedError


def build_eval_runs(results: Sequence[TaskResult]) -> list:
    """Преобразуй результаты задач в единый набор строк для агрегации leaderboard, не теряя модель, задачу, категорию и score."""
    raise NotImplementedError


def _calibration_blocks(buf: dict[str, list[tuple[float, float, int]]]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for model_id, entries in buf.items():
        if not entries:
            out[model_id] = {"ece": 0.0, "brier": 0.0, "populated_bins": 0, "n_samples": 0}
            continue
        confs = [e[0] for e in entries]
        corrs = [e[1] for e in entries]
        report = calib_mod.CalibrationReport.from_predictions(confs, corrs, bins=10)
        out[model_id] = {
            "ece": report.ece,
            "brier": report.brier,
            "populated_bins": report.populated_bins,
            "n_samples": report.n_samples,
        }
    return out


def _perplexity_blocks(adapters: Sequence[ModelAdapter], buf: dict[str, list[tuple[float, float, int]]],
                       results: Sequence[TaskResult], adapter_token_stats: dict[str, list[tuple[float, int]]]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for adapter in adapters:
        stats = adapter_token_stats.get(adapter.model_id, [])
        if not stats:
            out[adapter.model_id] = {"perplexity": float("nan"), "total_tokens": 0}
            continue
        nlls = [s[0] for s in stats]
        counts = [s[1] for s in stats]
        result = calib_mod.PerplexityResult.from_token_nll(nlls, counts)
        out[adapter.model_id] = result.to_dict()
    return out


def render_report(
    adapters: Sequence[ModelAdapter],
    tasks: Sequence[TaskSpec],
    results: Sequence[TaskResult],
    calibration_buf: dict[str, list[tuple[float, float, int]]],
    adapter_token_stats: dict[str, list[tuple[float, int]]],
    wall_seconds: float,
) -> EvalReport:
    """Собери итоговый отчёт с результатами, leaderboard, парными сравнениями, калибровкой и perplexity-блоками."""
    raise NotImplementedError


def render_markdown_block(report: EvalReport) -> str:
    rows = report.leaderboard
    header = "| Rank | Model | Mean | 95% CI | Win rate | Tasks | ECE | Brier |"
    sep = "|------|-------|------|--------|----------|-------|-----|-------|"
    out_lines = [header, sep]
    for i, row in enumerate(rows, start=1):
        cal = report.calibration.get(row["model_id"], {})
        ece = cal.get("ece", float("nan"))
        brier = cal.get("brier", float("nan"))
        ci = f"{row['mean_ci_lo']:.2f}-{row['mean_ci_hi']:.2f}"
        out_lines.append(
            f"| {i} | {row['model_id'][:20]} | {row['mean_score']:.2f} | {ci} | {row['win_rate']:.2f} | "
            f"{row['tasks_completed']} | {ece:.3f} | {brier:.3f} |"
        )
    return "\n".join(out_lines)


class RuleBasedAdapter(ModelAdapter):
    model_id = "rule_based"

    def __init__(self) -> None:
        self.token_stats: list[tuple[float, int]] = []

    def generate(self, prompt: str, task: TaskSpec) -> Generation:
        """Верни детерминированный ответ по типу задачи так, чтобы эталонный адаптер корректно обрабатывал все поддержанные категории."""
        raise NotImplementedError


class NoisyAdapter(ModelAdapter):
    model_id = "noisy"

    def __init__(self, seed: int = 0) -> None:
        self.rng = random.Random(seed)
        self.token_stats: list[tuple[float, int]] = []

    def generate(self, prompt: str, task: TaskSpec) -> Generation:
        if self.rng.random() < 0.25 and task.targets:
            text = task.targets[0]
        else:
            text = "I do not know"
            if task.post_process == "extract_letter":
                text = "Answer: A"
            if task.metric_name == "code_exec":
                text = "```python\ndef add(a, b):\n    return a - b\n```"
        token_count = max(1, len(text.split()))
        nll = token_count * 2.5
        self.token_stats.append((nll, token_count))
        return Generation(text=text, confidence=0.85, token_nll=nll, token_count=token_count)


class BiasedAdapter(ModelAdapter):
    model_id = "biased"

    def __init__(self, good_category: str = "arithmetic") -> None:
        self.good_category = good_category
        self.token_stats: list[tuple[float, int]] = []

    def generate(self, prompt: str, task: TaskSpec) -> Generation:
        if task.category == self.good_category and task.targets:
            text = task.targets[0]
            confidence = 0.9
            nll_per_token = 1.0
        else:
            text = "guess"
            if task.post_process == "extract_letter":
                text = "Answer: B"
            if task.metric_name == "code_exec":
                text = "```python\ndef add(a, b):\n    return None\n```"
            confidence = 0.4
            nll_per_token = 3.0
        token_count = max(1, len(text.split()))
        nll = token_count * nll_per_token
        self.token_stats.append((nll, token_count))
        return Generation(text=text, confidence=confidence, token_nll=nll, token_count=token_count)


def _load_fixture_tasks() -> list:
    import tempfile
    out_dir = tempfile.mkdtemp(prefix="aie_l75_")
    good, _bad = spec_mod.load_fixtures(out_dir)
    tasks, errors = spec_mod.validate_file(good)
    if errors:
        raise RuntimeError(f"fixture validation failed: {errors}")
    return tasks


def demo() -> int:
    tasks = _load_fixture_tasks()
    adapters = [RuleBasedAdapter(), NoisyAdapter(seed=1), BiasedAdapter(good_category="arithmetic")]
    t0 = time.time()
    results, calibration_buf = run_eval(adapters, tasks, parallel=True, max_workers=6, code_exec_timeout_s=2.0)
    wall = time.time() - t0

    adapter_token_stats = {
        a.model_id: list(getattr(a, "token_stats", [])) for a in adapters
    }
    report = render_report(adapters, tasks, results, calibration_buf, adapter_token_stats, wall)

    print(render_markdown_block(report))
    print()
    print(f"summary: {json.dumps(report.summary, indent=2)}")
    print()
    print("pairwise differences (paired bootstrap):")
    for d in report.pairwise:
        sig = "yes" if d["significant"] else "no"
        print(f"  {d['model_a']} vs {d['model_b']}: diff={d['diff_mean']:+.3f}  ci=[{d['ci_lo']:+.3f},{d['ci_hi']:+.3f}]  significant={sig}")

    if not report.leaderboard:
        print("ERROR: empty leaderboard")
        return 1
    top = report.leaderboard[0]["model_id"]
    bot = report.leaderboard[-1]["model_id"]
    if top != "rule_based":
        print(f"ERROR: expected rule_based at top, got {top}")
        return 2
    if bot == "rule_based":
        print(f"ERROR: rule_based should not be at the bottom")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(demo())
