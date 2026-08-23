"""End-to-end auto-research demo: seed -> scheduler -> critic loop -> paper writer.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 19 lesson 54 (paper writer)
- Phase 19 lesson 55 (critic loop)
- Phase 19 lesson 56 (iteration scheduler)
- Phase 19 lessons 50-53 (earlier auto-research stages; the seed/runner stub here stands in for them)

Stdlib + numpy only. Run: python3 code/main.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Awaitable, Callable


HERE = os.path.dirname(os.path.abspath(__file__))
LESSON_ROOT = os.path.join(HERE, "_resources")
if not os.path.isdir(LESSON_ROOT):
    LESSON_ROOT = os.path.dirname(os.path.dirname(HERE))


def _add(path: str) -> None:
    if path not in sys.path:
        sys.path.insert(0, path)


_add(os.path.join(LESSON_ROOT, "54-paper-writer", "code"))
_add(os.path.join(LESSON_ROOT, "55-critic-loop", "code"))
_add(os.path.join(LESSON_ROOT, "56-iteration-scheduler", "code"))

import importlib
import importlib.util


def _load_module(name: str, file_path: str):
    spec = importlib.util.spec_from_file_location(name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {name} from {file_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


paper_writer_mod = _load_module(
    "_t_d2_paper_writer",
    os.path.join(LESSON_ROOT, "54-paper-writer", "code", "main.py"),
)
critic_loop_mod = _load_module(
    "_t_d2_critic_loop",
    os.path.join(LESSON_ROOT, "55-critic-loop", "code", "main.py"),
)
scheduler_mod = _load_module(
    "_t_d2_scheduler",
    os.path.join(LESSON_ROOT, "56-iteration-scheduler", "code", "main.py"),
)


Paper = paper_writer_mod.Paper
Section = paper_writer_mod.Section
Figure = paper_writer_mod.Figure
BibEntry = paper_writer_mod.BibEntry
PaperWriter = paper_writer_mod.PaperWriter
PaperValidationError = paper_writer_mod.PaperValidationError
MockProseGenerator = paper_writer_mod.MockProseGenerator

MiniPaper = critic_loop_mod.MiniPaper
MiniSection = critic_loop_mod.MiniSection
CriticLoop = critic_loop_mod.CriticLoop
deterministic_critic = critic_loop_mod.deterministic_critic
deterministic_reviser = critic_loop_mod.deterministic_reviser

Hypothesis = scheduler_mod.Hypothesis
Result = scheduler_mod.Result
IterationScheduler = scheduler_mod.IterationScheduler
SchedulerReport = scheduler_mod.SchedulerReport
make_deterministic_runner = scheduler_mod.make_deterministic_runner


class NoTriggerError(Exception):
    """No branch crossed the paper threshold; demo cannot pick a best result."""


class BestResultError(Exception):
    """Picker received an empty trigger list."""


@dataclass
class DemoReport:
    scheduler_report: dict
    best_branch: str
    best_reward: float
    critic_result: dict
    paper_manifest: dict
    stop_reason: str

    def to_dict(self) -> dict:
        return {
            "scheduler_report": self.scheduler_report,
            "best_branch": self.best_branch,
            "best_reward": self.best_reward,
            "critic_result": self.critic_result,
            "paper_manifest": self.paper_manifest,
            "stop_reason": self.stop_reason,
        }


def make_seed_hypotheses() -> list[Hypothesis]:
    """Сформируйте детерминированный список из трёх исходных гипотез для трёх разных исследовательских веток."""
    raise NotImplementedError


def pick_best_branch(scheduler_report: SchedulerReport) -> tuple[str, float]:
    """Выберите среди сработавших веток ветку с максимальной средней наградой, детерминированно разрешите ничью и выбросьте предусмотренные типизированные ошибки для пустых или некорректных триггеров."""
    raise NotImplementedError


def _originality_for_reward(reward: float) -> str:
    if reward >= 0.8:
        return "high"
    if reward >= 0.6:
        return "medium"
    return "low"


def build_mini_paper(branch: str, reward: float) -> MiniPaper:
    return MiniPaper(
        title=f"Auto-Research Findings on Branch {branch}",
        abstract=f"We summarise the best yielding branch {branch} from the auto-research loop.",
        sections=[
            MiniSection(id="intro", title="Introduction", body="initial observations"),
            MiniSection(id="results", title="Results", body=""),
        ],
        originality_tag=_originality_for_reward(reward),
    )


def mini_to_full_paper(mini: MiniPaper, branch: str) -> Paper:
    """Преобразуйте MiniPaper в Paper, сохранив секции и цитаты, добавив библиографию для всех cite key и фигуру результатов выбранной ветки."""
    raise NotImplementedError


async def _run_demo_async(out_dir: str, seed: int = 11) -> DemoReport:
    """Соедините генерацию гипотез, планировщик, выбор лучшей ветки, цикл критики и запись статьи в единый асинхронный конвейер с коротким замыканием при нарушении контракта."""
    raise NotImplementedError


def run_demo(out_dir: str | None = None, seed: int = 11) -> DemoReport:
    if out_dir is None:
        out_dir = tempfile.mkdtemp(prefix="auto-research-demo-")
    return asyncio.run(_run_demo_async(out_dir, seed=seed))


def demo() -> dict:
    return run_demo().to_dict()


if __name__ == "__main__":
    rep = demo()
    print(json.dumps({
        "stop_reason": rep["stop_reason"],
        "best_branch": rep["best_branch"],
        "best_reward": rep["best_reward"],
        "critic_status": rep["critic_result"]["status"],
        "critic_rounds": rep["critic_result"]["rounds_used"],
        "paper_sections": [s["id"] for s in rep["paper_manifest"]["sections"]],
        "paper_figures": [f["id"] for f in rep["paper_manifest"]["figures"]],
        "experiments_run": rep["scheduler_report"]["experiments_run"],
    }, indent=2))
