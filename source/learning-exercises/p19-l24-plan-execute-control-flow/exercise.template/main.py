"""Plan-and-execute agent with replan on failure, plan diffs, and dual budgets.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 14 lesson 01 (agent loop fundamentals)
- Phase 13 lesson 02 (tool protocols overview)

Stdlib only. Run: python3 code/main.py
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Step:
    id: int
    tool_name: str
    args: dict
    expected_outcome: str
    result: Any | None = None
    error: str | None = None

    def signature(self) -> tuple:
        return (self.tool_name, json.dumps(self.args, sort_keys=True))


@dataclass
class PlanDiff:
    revision: int
    removed: list[int]
    added: list[int]
    revised: list[int]

    def to_dict(self) -> dict:
        return {
            "revision": self.revision,
            "removed": list(self.removed),
            "added": list(self.added),
            "revised": list(self.revised),
        }


@dataclass
class Event:
    type: str
    payload: dict
    ts: float = field(default_factory=time.time)


@dataclass
class SessionResult:
    status: str
    reason: str
    history: list[Step]
    revisions: list[PlanDiff]
    events: list[Event]

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reason": self.reason,
            "history": [
                {"id": s.id, "tool": s.tool_name, "args": s.args,
                 "result": s.result, "error": s.error}
                for s in self.history
            ],
            "revisions": [r.to_dict() for r in self.revisions],
            "events": [{"type": e.type, "payload": e.payload, "ts": e.ts} for e in self.events],
        }


Planner = Callable[[str, list[Step], str | None], list[Step]]
ToolExecutor = Callable[[str, dict], Any]


class ToolFailure(Exception):
    pass


def _diff_plans(old: list[Step], new: list[Step], revision: int) -> PlanDiff:
    """Вычислите различия между старым и новым планами по идентификаторам шагов и их сигнатурам."""
    raise NotImplementedError


class PlanExecuteAgent:
    """Sequential plan executor with replan on failure."""

    def __init__(
        self,
        planner: Planner,
        executor: ToolExecutor,
        *,
        max_steps: int = 12,
        max_replans: int = 5,
    ) -> None:
        self._planner = planner
        self._executor = executor
        self.max_steps = max_steps
        self.max_replans = max_replans
        self._events: list[Event] = []

    def _emit(self, etype: str, payload: dict) -> None:
        """Добавьте событие указанного типа и с переданной нагрузкой в журнал текущего запуска."""
        raise NotImplementedError

    def run(self, goal: str) -> SessionResult:
        """Реализуйте последовательное исполнение плана с фиксацией истории, перепланированием после ошибок, событиями и жёсткими лимитами шагов и ревизий."""
        raise NotImplementedError


def _summarize(plan: list[Step]) -> list[dict]:
    return [{"id": s.id, "tool": s.tool_name, "outcome": s.expected_outcome} for s in plan]


def make_deterministic_planner(fail_step_id: int | None, recovery: str = "route_around") -> Planner:
    """Реализуйте детерминированный планировщик: сформируйте начальный план и выберите план восстановления по последней ошибке и заданной стратегии."""
    raise NotImplementedError


def _demo() -> None:
    counters = {"transform_v1_calls": 0}

    def executor(tool: str, args: dict) -> Any:
        if args.get("_force_fail"):
            counters["transform_v1_calls"] += 1
            raise ToolFailure(f"{tool} marker-forced failure")
        if tool == "fetch":
            return {"k": "v"}
        if tool == "transform":
            if args.get("mode") == "v1":
                counters["transform_v1_calls"] += 1
                raise ToolFailure("transform v1 backend down")
            return {"ok": True}
        if tool == "render":
            return "html"
        if tool == "submit":
            return {"id": 1}
        if tool in ("log_failure", "notify_user"):
            return "logged"
        raise ToolFailure(f"unknown tool {tool}")

    agent = PlanExecuteAgent(
        planner=make_deterministic_planner(fail_step_id=2, recovery="route_around"),
        executor=executor,
        max_steps=12, max_replans=5,
    )
    res = agent.run("ship the report")
    print(json.dumps({
        "status": res.status,
        "reason": res.reason,
        "history": [(s.id, s.tool_name, bool(s.error)) for s in res.history],
        "revisions": [r.to_dict() for r in res.revisions],
        "events": [e.type for e in res.events],
        "transform_v1_calls": counters["transform_v1_calls"],
    }, indent=2))


if __name__ == "__main__":
    _demo()
