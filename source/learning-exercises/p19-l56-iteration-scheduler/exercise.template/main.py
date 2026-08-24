"""Auto-research orchestrator: hypothesis queue, parallel slots, UCB scoring, fan-out.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 19 lesson 54 (paper writer; receives paper.trigger fan-out)
- Phase 19 lesson 55 (critic loop; consumes results downstream)
- Phase 19 lessons 50-53 (earlier auto-research stages)

Stdlib + numpy only. Run: python3 code/main.py
"""

from __future__ import annotations

import asyncio
import json
import math
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import numpy as np


@dataclass
class Hypothesis:
    id: str
    branch: str
    payload: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"id": self.id, "branch": self.branch, "payload": dict(self.payload)}


@dataclass
class Result:
    hypothesis_id: str
    branch: str
    reward: float
    payload: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "hypothesis_id": self.hypothesis_id,
            "branch": self.branch,
            "reward": self.reward,
            "payload": dict(self.payload),
        }


@dataclass
class BranchStats:
    branch: str
    runs: int = 0
    reward_sum: float = 0.0
    pruned: bool = False
    paper_triggered: bool = False

    @property
    def mean(self) -> float:
        return (self.reward_sum / self.runs) if self.runs else 0.0

    def to_dict(self) -> dict:
        return {
            "branch": self.branch,
            "runs": self.runs,
            "reward_sum": self.reward_sum,
            "mean": self.mean,
            "pruned": self.pruned,
            "paper_triggered": self.paper_triggered,
        }


@dataclass
class TraceEvent:
    kind: str
    payload: dict

    def to_dict(self) -> dict:
        return {"kind": self.kind, "payload": dict(self.payload)}


@dataclass
class SchedulerReport:
    stop_reason: str
    experiments_run: int
    wall_seconds: float
    branches: list[BranchStats]
    paper_triggers: list[str]
    trace: list[TraceEvent]

    def to_dict(self) -> dict:
        return {
            "stop_reason": self.stop_reason,
            "experiments_run": self.experiments_run,
            "wall_seconds": round(self.wall_seconds, 4),
            "branches": [b.to_dict() for b in self.branches],
            "paper_triggers": list(self.paper_triggers),
            "trace": [e.to_dict() for e in self.trace],
        }


Runner = Callable[[Hypothesis], Awaitable[Result]]
Expander = Callable[[Result], list[Hypothesis]]


def ucb_score(branch_stats: BranchStats, total_runs: int, c: float) -> float:
    """Рассчитайте UCB1-оценку ветки с обязательным приоритетом для веток без завершённых запусков."""
    raise NotImplementedError


class IterationScheduler:
    """Drives a hypothesis queue across N parallel asyncio slots with UCB picking."""

    def __init__(
        self,
        runner: Runner,
        slots: int = 3,
        max_experiments: int = 50,
        max_seconds: float = 30.0,
        exploration_c: float = math.sqrt(2.0),
        paper_threshold: float = 0.7,
        prune_floor: float = 0.2,
        prune_after_runs: int = 3,
        expander: Expander | None = None,
    ) -> None:
        if slots < 1:
            raise ValueError("slots must be >= 1")
        if max_experiments < 1:
            raise ValueError("max_experiments must be >= 1")
        self.runner = runner
        self.slots = slots
        self.max_experiments = max_experiments
        self.max_seconds = max_seconds
        self.exploration_c = exploration_c
        self.paper_threshold = paper_threshold
        self.prune_floor = prune_floor
        self.prune_after_runs = prune_after_runs
        self.expander = expander

    def _pick_next(self, queue: list[Hypothesis], stats: dict[str, BranchStats]) -> int | None:
        best_idx: int | None = None
        best_score = -float("inf")
        total_runs = sum(s.runs for s in stats.values())
        for idx, hyp in enumerate(queue):
            bs = stats.get(hyp.branch)
            if bs is not None and bs.pruned:
                continue
            score = ucb_score(bs or BranchStats(branch=hyp.branch),
                              total_runs, self.exploration_c)
            if score > best_score:
                best_score = score
                best_idx = idx
        return best_idx

    async def run(self, seed: list[Hypothesis]) -> SchedulerReport:
        """Реализуйте асинхронный цикл планировщика: заполняйте параллельные слоты, обрабатывайте результаты, обновляйте статистику, запускайте paper fan-out, отсечение веток и остановку по бюджетам."""
        raise NotImplementedError


def make_deterministic_runner(
    base_rewards: dict[str, float],
    noise: float = 0.05,
    delay_ms: float = 5.0,
    seed: int = 0,
) -> Runner:
    """Создайте воспроизводимый асинхронный runner, который добавляет seeded-шум к награде ветки и ограничивает результат диапазоном от 0 до 1."""
    raise NotImplementedError


def deterministic_expander(result: Result) -> list[Hypothesis]:
    """Сформируйте две детерминированные дочерние гипотезы той же ветки с идентификаторами и payload, связанными с родительским результатом."""
    raise NotImplementedError


async def demo_async() -> dict:
    seed = [
        Hypothesis(id="h-a-1", branch="branch-a"),
        Hypothesis(id="h-b-1", branch="branch-b"),
        Hypothesis(id="h-c-1", branch="branch-c"),
        Hypothesis(id="h-d-1", branch="branch-d"),
    ]
    runner = make_deterministic_runner(
        base_rewards={"branch-a": 0.85, "branch-b": 0.55, "branch-c": 0.15, "branch-d": 0.40},
        seed=7, delay_ms=2.0,
    )
    sched = IterationScheduler(
        runner=runner, slots=3, max_experiments=20,
        paper_threshold=0.7, prune_floor=0.25, prune_after_runs=3,
        expander=deterministic_expander,
    )
    report = await sched.run(seed)
    return report.to_dict()


def demo() -> dict:
    return asyncio.run(demo_async())


if __name__ == "__main__":
    r = demo()
    print(json.dumps({
        "stop_reason": r["stop_reason"],
        "experiments_run": r["experiments_run"],
        "wall_seconds": r["wall_seconds"],
        "paper_triggers": r["paper_triggers"],
        "branches": r["branches"],
    }, indent=2))
