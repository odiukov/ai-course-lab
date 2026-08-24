import contextlib
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import main


class TestPlanStateSummary(unittest.TestCase):
    def test_formats_every_status_without_mutating_items(self):
        items = [
            main.TodoItem(1, "queued", "pending"),
            main.TodoItem(2, "working", "in_progress"),
            main.TodoItem(3, "finished", "done"),
            main.TodoItem(4, "broken", "failed"),
        ]
        plan = main.PlanState(goal="ship", items=items)

        self.assertEqual(
            plan.summary(),
            "GOAL: ship\n"
            "  [ ] 1. queued\n"
            "  [>] 2. working\n"
            "  [x] 3. finished\n"
            "  [!] 4. broken",
        )
        self.assertIs(plan.items, items)


class TestModelStep(unittest.TestCase):
    def test_rewrites_scripted_plan_and_preserves_fallback_plan(self):
        existing = main.TodoItem(9, "existing", "pending", "keep")
        plan = main.PlanState("goal", [existing])
        script = [{
            "plan": [("first", "in_progress"), ("second", "pending")],
            "tool": ("read_file", {"path": "x.txt"}),
            "tokens": 7,
            "cost": 0.25,
        }]

        with mock.patch.object(main, "SCRIPT", script):
            scripted = main.model_step(plan, 0)
            fallback = main.model_step(plan, 1)

        self.assertEqual(
            [(item.id, item.description, item.status, item.note) for item in scripted["plan"]],
            [(1, "first", "in_progress", ""), (2, "second", "pending", "")],
        )
        self.assertEqual(scripted["tool"], ("read_file", {"path": "x.txt"}))
        self.assertEqual((scripted["tokens"], scripted["cost"]), (7, 0.25))
        self.assertEqual(plan.items, [existing])
        self.assertIs(fallback["plan"], plan.items)
        self.assertIsNone(fallback["tool"])
        self.assertEqual((fallback["tokens"], fallback["cost"]), (200, 0.005))


class TestToolReadFile(unittest.TestCase):
    def test_truncates_content_and_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory() as root:
            sandbox = os.path.join(root, "sandbox")
            os.mkdir(sandbox)
            payload = "a" * (main.TRUNCATE_BYTES + 17)
            inside = os.path.join(sandbox, "inside.txt")
            outside = os.path.join(root, "outside.txt")
            with open(inside, "w", encoding="utf-8") as handle:
                handle.write(payload)
            with open(outside, "w", encoding="utf-8") as handle:
                handle.write("secret")

            self.assertEqual(
                main.tool_read_file(sandbox, "inside.txt"),
                payload[:main.TRUNCATE_BYTES],
            )
            with self.assertRaisesRegex(RuntimeError, "path escapes sandbox"):
                main.tool_read_file(sandbox, "../outside.txt")


class TestToolRunShell(unittest.TestCase):
    def test_uses_sandbox_timeout_and_bounds_combined_output(self):
        completed = SimpleNamespace(
            stdout="o" * (main.TRUNCATE_BYTES + 5),
            stderr="ERR",
            returncode=3,
        )
        with mock.patch.object(main.subprocess, "run", return_value=completed) as run:
            result = main.tool_run_shell("/virtual/sandbox", "fake-command", timeout=7)

        run.assert_called_once_with(
            "fake-command",
            cwd="/virtual/sandbox",
            shell=True,
            capture_output=True,
            text=True,
            timeout=7,
        )
        self.assertEqual(result, "exit=3\n" + ("o" * main.TRUNCATE_BYTES))


class TestHookBusFire(unittest.TestCase):
    def test_runs_hooks_in_order_and_propagates_replacement_payload(self):
        bus = main.HookBus()
        seen = []

        def first(payload):
            seen.append(("first", payload["value"]))
            payload["value"] += 1
            return None

        def second(payload):
            seen.append(("second", payload["value"]))
            return {"value": payload["value"] * 2}

        bus.on("Notification", first)
        bus.on("Notification", second)
        original = {"value": 2}

        result = bus.fire("Notification", original)

        self.assertEqual(seen, [("first", 2), ("second", 3)])
        self.assertEqual(original, {"value": 3})
        self.assertEqual(result, {"value": 6})


class TestDestructiveGuard(unittest.TestCase):
    def test_blocks_destructive_commands_but_leaves_benign_call_unblocked(self):
        benign = {"tool": "run_shell", "args": {"cmd": "ls -la"}}
        self.assertIs(main.destructive_guard(benign), benign)
        self.assertNotIn("blocked", benign)

        for command in ("rm -rf /tmp/work", "shutdown -h now"):
            with self.subTest(command=command):
                payload = {"tool": "run_shell", "args": {"cmd": command}}
                result = main.destructive_guard(payload)
                self.assertIs(result, payload)
                self.assertIs(result["blocked"], True)
                self.assertEqual(
                    result["reason"],
                    "destructive command blocked by PreToolUse hook",
                )


class TestBudgetExceeded(unittest.TestCase):
    def test_thresholds_and_precedence(self):
        cases = [
            (main.Budget(turns_used=49, tokens_used=199999, dollars_used=4.999), None),
            (main.Budget(turns_used=50), "turn_limit"),
            (main.Budget(tokens_used=200000), "token_limit"),
            (main.Budget(dollars_used=5.0), "dollar_limit"),
            (
                main.Budget(turns_used=50, tokens_used=200000, dollars_used=5.0),
                "turn_limit",
            ),
        ]
        for budget, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(budget.exceeded(), expected)


class TestBudgetStep(unittest.TestCase):
    def test_accumulates_each_turn_tokens_and_cost(self):
        budget = main.Budget(turns_used=1, tokens_used=10, dollars_used=0.5)

        budget.step(5, 0.25)
        budget.step(7, 0.125)

        self.assertEqual(budget.turns_used, 3)
        self.assertEqual(budget.tokens_used, 22)
        self.assertAlmostEqual(budget.dollars_used, 0.875)


class TestRunAgent(unittest.TestCase):
    def test_recovers_from_tool_error_and_ends_session_before_return(self):
        steps = [
            {
                "plan": [main.TodoItem(1, "recover", "in_progress")],
                "tool": ("explode", {}),
                "tokens": 11,
                "cost": 0.1,
            },
            {
                "plan": [main.TodoItem(1, "recover", "done")],
                "tool": None,
                "tokens": 7,
                "cost": 0.2,
            },
        ]
        tool = mock.Mock(side_effect=RuntimeError("boom"))

        def isolated_fire(bus, event, payload):
            for callback in bus._hooks[event]:
                payload = callback(payload) or payload
            return payload

        def isolated_step(budget, tokens, dollars):
            budget.turns_used += 1
            budget.tokens_used += tokens
            budget.dollars_used += dollars

        with contextlib.ExitStack() as stack:
            model = stack.enter_context(
                mock.patch.object(main, "model_step", side_effect=steps)
            )
            stack.enter_context(mock.patch.object(main, "TOOLS", {"explode": tool}))
            stack.enter_context(
                mock.patch.object(main.PlanState, "summary", return_value="SUMMARY")
            )
            stack.enter_context(
                mock.patch.object(main.Budget, "exceeded", autospec=True, return_value=None)
            )
            stack.enter_context(
                mock.patch.object(
                    main.Budget,
                    "step",
                    autospec=True,
                    side_effect=isolated_step,
                )
            )
            stack.enter_context(
                mock.patch.object(
                    main.HookBus,
                    "fire",
                    autospec=True,
                    side_effect=isolated_fire,
                )
            )
            stack.enter_context(
                mock.patch.object(main, "destructive_guard", side_effect=lambda payload: payload)
            )
            stack.enter_context(mock.patch.object(main.time, "time", return_value=123.0))

            result = main.run_agent("task", "/virtual/sandbox")

        self.assertEqual(model.call_count, 2)
        tool.assert_called_once_with("/virtual/sandbox")
        self.assertEqual(result["plan"], "SUMMARY")
        self.assertEqual(result["budget"]["turns_used"], 2)
        self.assertEqual(result["budget"]["tokens_used"], 18)
        self.assertAlmostEqual(result["budget"]["dollars_used"], 0.3)
        self.assertEqual([event["event"] for event in result["trace"]], ["start", "tool", "end"])
        self.assertEqual(
            result["trace"][1],
            {"event": "tool", "tool": "explode", "ok": False, "error": "boom"},
        )
        self.assertEqual(result["trace"][-1]["turns"], 2)
        self.assertEqual(result["trace"][-1]["tokens"], 18)
        self.assertAlmostEqual(result["trace"][-1]["dollars"], 0.3)


if __name__ == "__main__":
    unittest.main()
