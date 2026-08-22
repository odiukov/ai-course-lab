"""Узкие проверки шагов лаборатории 20.

Авторский suite остаётся в tests/test_loop.py и запускается целиком на
последнем шве. Эти тесты нужны раньше: каждый зависит только от уже пройденных
целей, поэтому корректный шаг не краснеет из-за будущей заглушки.
"""

from __future__ import annotations

import time
import unittest

from main import Budget, HarnessLoop, HookRegistry, PullRequest, SessionResult, State, Step


def linear_planner(goal: str, history: list[Step]) -> list[Step]:
    if history:
        return []
    return [Step(id=1, description=f"finish {goal}", requires_tool=False)]


def tool_planner(goal: str, history: list[Step]) -> list[Step]:
    if history:
        return []
    return [
        Step(
            id=1,
            description=f"fetch for {goal}",
            requires_tool=True,
            tool_name="db.get",
            tool_args={"id": 7},
        )
    ]


class TestStepContracts(unittest.TestCase):
    def test_budget_reports_each_limit_in_priority_order(self) -> None:
        budget = Budget(max_turns=1, max_tool_calls=1, max_wall_seconds=10.0)
        self.assertIsNone(budget.exceeded())
        budget.turns = 1
        budget.tool_calls = 1
        self.assertEqual(budget.exceeded(), "turns")
        budget.turns = 0
        self.assertEqual(budget.exceeded(), "tool_calls")
        budget.tool_calls = 0
        budget.started_at = time.time() - 20.0
        self.assertEqual(budget.exceeded(), "wall_clock")

    def test_hook_registry_preserves_registration_order(self) -> None:
        registry = HookRegistry()
        seen: list[str] = []
        registry.on("before_plan", lambda payload: seen.append("first") or payload["goal"])
        registry.on("before_plan", lambda payload: seen.append("second") or payload["goal"].upper())
        self.assertEqual(registry.fire("before_plan", {"goal": "ship"}), ["ship", "SHIP"])
        self.assertEqual(seen, ["first", "second"])

    def test_transition_accepts_legal_edge_and_rejects_illegal_edge(self) -> None:
        loop = HarnessLoop(planner=linear_planner)
        loop._transition(State.PLANNING)
        self.assertEqual(loop.state, State.PLANNING)
        with self.assertRaises(RuntimeError):
            loop._transition(State.AWAITING_TOOL)

    def test_run_initializes_and_completes_linear_plan(self) -> None:
        loop = HarnessLoop(planner=linear_planner)
        result = loop.run("demo")
        self.assertIsInstance(result, SessionResult)
        self.assertEqual(result.state, State.DONE)
        self.assertEqual(result.reason, "goal_met")
        self.assertEqual(result.events[0].type, "session.start")
        self.assertEqual(result.events[0].payload, {"goal": "demo"})

    def test_resume_consumes_tool_result(self) -> None:
        loop = HarnessLoop(planner=tool_planner)
        pull = loop.run("demo")
        self.assertIsInstance(pull, PullRequest)
        self.assertEqual(loop.state, State.AWAITING_TOOL)
        result = loop.resume({"result": {"name": "Ada"}})
        self.assertIsInstance(result, SessionResult)
        self.assertEqual(result.steps[0].result, {"name": "Ada"})
        self.assertEqual(result.state, State.DONE)


if __name__ == "__main__":
    unittest.main()
