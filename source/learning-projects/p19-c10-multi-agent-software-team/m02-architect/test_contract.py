import random
import unittest
from collections import defaultdict
from unittest.mock import Mock, patch

import main


class RecordingBoard:
    def __init__(self):
        self.messages = []
        self.tokens_by_role = defaultdict(int)

    def post(self, message):
        self.messages.append(message)
        self.tokens_by_role[message.by] += message.tokens


class TestBoardPost(unittest.TestCase):
    def test_appends_in_order_and_accumulates_tokens(self):
        board = main.Board()
        first = main.Msg(main.MsgKind.SUBTASK, by="architect", to="coder-A", tokens=12)
        second = main.Msg(main.MsgKind.PLAN_REQUEST, by="architect", to="board", tokens=8)
        third = main.Msg(main.MsgKind.DIFF_READY, by="coder-A", to="merge_coord", tokens=30)

        self.assertIsNone(board.post(first))
        board.post(second)
        board.post(third)

        self.assertEqual(board.messages, [first, second, third])
        self.assertEqual(dict(board.tokens_by_role), {"architect": 20, "coder-A": 30})


class TestBoardInbox(unittest.TestCase):
    def test_filters_by_exact_recipient_preserving_order(self):
        wanted_a = main.Msg(main.MsgKind.SUBTASK, by="architect", to="coder-A")
        other = main.Msg(main.MsgKind.SUBTASK, by="architect", to="coder-B")
        wanted_b = main.Msg(main.MsgKind.REVIEW_FEEDBACK, by="reviewer", to="coder-A")
        board = main.Board(messages=[wanted_a, other, wanted_b])

        result = board.inbox("coder-A")

        self.assertEqual(result, [wanted_a, wanted_b])
        self.assertIs(result[0], wanted_a)
        self.assertEqual(board.inbox("missing-role"), [])
        self.assertEqual(board.messages, [wanted_a, other, wanted_b])


class TestArchitectPlan(unittest.TestCase):
    def test_builds_expected_plan_and_obeys_bug_injection_boundary(self):
        rng = Mock(spec=random.Random)
        rng.randrange.return_value = 2
        rng.random.return_value = 0.29

        plan = main.architect_plan("fix parser race", rng)

        self.assertEqual([s.name for s in plan], ["parser", "cache", "api", "migration"])
        self.assertEqual(
            [s.files for s in plan],
            [["src/parser.py"], ["src/cache.py", "src/cache_test.py"], ["src/api.py"], ["src/migrate.py"]],
        )
        self.assertEqual([s.lines_changed for s in plan], [0, 0, 0, 0])
        self.assertEqual([s.has_bug for s in plan], [False, False, True, False])
        rng.randrange.assert_called_once_with(4)
        rng.random.assert_called_once_with()

        boundary_rng = Mock(spec=random.Random)
        boundary_rng.randrange.return_value = 1
        boundary_rng.random.return_value = 0.30
        boundary_plan = main.architect_plan("another issue", boundary_rng)
        self.assertFalse(any(s.has_bug for s in boundary_plan))


class TestCoderImplement(unittest.TestCase):
    def test_records_generated_line_count_and_returns_complete_diff(self):
        subtask = main.Subtask("cache", ["src/cache.py"], has_bug=True)
        rng = Mock(spec=random.Random)
        rng.randint.return_value = 57

        result = main.coder_implement(subtask, rng)

        self.assertEqual(result, {"subtask": "cache", "lines": 57, "has_bug": True})
        self.assertEqual(subtask.lines_changed, 57)
        rng.randint.assert_called_once_with(15, 95)


class TestReviewerCheck(unittest.TestCase):
    def test_handles_clean_caught_and_false_approved_diffs(self):
        unused_rng = Mock(spec=random.Random)
        self.assertEqual(
            main.reviewer_check([{"subtask": "api", "has_bug": False}], unused_rng),
            (True, "lgtm"),
        )
        unused_rng.random.assert_not_called()

        caught_rng = Mock(spec=random.Random)
        caught_rng.random.return_value = 0.849
        diffs = [
            {"subtask": "parser", "has_bug": False},
            {"subtask": "cache", "has_bug": True},
            {"subtask": "api", "has_bug": True},
        ]
        self.assertEqual(
            main.reviewer_check(diffs, caught_rng),
            (False, "found bug in cache: please revisit"),
        )

        boundary_rng = Mock(spec=random.Random)
        boundary_rng.random.return_value = 0.85
        self.assertEqual(
            main.reviewer_check(diffs, boundary_rng),
            (True, "lgtm (FALSE-APPROVE)"),
        )


class TestTesterRun(unittest.TestCase):
    def test_prioritizes_real_bugs_and_applies_flake_threshold(self):
        unused_rng = Mock(spec=random.Random)
        buggy = [
            {"subtask": "migration", "has_bug": True},
            {"subtask": "api", "has_bug": True},
        ]
        self.assertEqual(
            main.tester_run(buggy, unused_rng),
            (False, "test fails in migration module"),
        )
        unused_rng.random.assert_not_called()

        flaky_rng = Mock(spec=random.Random)
        flaky_rng.random.return_value = 0.029
        self.assertEqual(main.tester_run([], flaky_rng), (False, "flaky test"))

        boundary_rng = Mock(spec=random.Random)
        boundary_rng.random.return_value = 0.03
        self.assertEqual(main.tester_run([], boundary_rng), (True, "412/412 passing"))


class TestRunTeam(unittest.TestCase):
    def test_success_flow_and_accounting_with_dependencies_isolated(self):
        board = RecordingBoard()
        plan = [
            main.Subtask("parser", ["src/parser.py"]),
            main.Subtask("api", ["src/api.py"]),
        ]
        coder = Mock(side_effect=[
            {"subtask": "parser", "lines": 20, "has_bug": False},
            {"subtask": "api", "lines": 30, "has_bug": False},
        ])

        with patch.object(main, "Board", return_value=board), \
             patch.object(main, "architect_plan", return_value=plan) as architect, \
             patch.object(main, "coder_implement", coder), \
             patch.object(main, "reviewer_check", return_value=(True, "lgtm")) as reviewer, \
             patch.object(main, "tester_run", return_value=(True, "all green")) as tester:
            result = main.run_team("issue-7", n_coders=2, rng=Mock(spec=random.Random))

        architect.assert_called_once()
        self.assertEqual(coder.call_count, 2)
        reviewer.assert_called_once_with([
            {"subtask": "parser", "lines": 20, "has_bug": False},
            {"subtask": "api", "lines": 30, "has_bug": False},
        ], architect.call_args.args[1])
        tester.assert_called_once()
        self.assertEqual(
            [m.kind for m in board.messages],
            [
                main.MsgKind.PLAN_REQUEST,
                main.MsgKind.SUBTASK,
                main.MsgKind.SUBTASK,
                main.MsgKind.DIFF_READY,
                main.MsgKind.DIFF_READY,
                main.MsgKind.REVIEW_NEEDED,
                main.MsgKind.APPROVED,
                main.MsgKind.TEST_PASSED,
            ],
        )
        self.assertEqual(result["handoffs"], 8)
        self.assertEqual(result["total_tokens"], 19800)
        self.assertEqual(
            result["tokens_by_role"],
            {
                "architect": 6900,
                "coder-A": 3800,
                "coder-B": 4100,
                "merge_coord": 2000,
                "reviewer": 1800,
                "tester": 1200,
            },
        )
        self.assertTrue(result["approved"])
        self.assertTrue(result["tested_passed"])
        self.assertEqual(result["test_msg"], "all green")

    def test_rejected_review_routes_revision_and_tests_sanitized_diffs(self):
        board = RecordingBoard()
        plan = [main.Subtask("cache", ["src/cache.py"], has_bug=True)]
        initial_diff = {"subtask": "cache", "lines": 40, "has_bug": True}
        tester = Mock(return_value=(False, "still failing"))

        with patch.object(main, "Board", return_value=board), \
             patch.object(main, "architect_plan", return_value=plan), \
             patch.object(main, "coder_implement", return_value=initial_diff), \
             patch.object(main, "reviewer_check", return_value=(False, "fix cache")), \
             patch.object(main, "tester_run", tester):
            result = main.run_team("issue-8", n_coders=1, rng=Mock(spec=random.Random))

        tested_diffs = tester.call_args.args[0]
        self.assertEqual(tested_diffs, [{"subtask": "cache", "lines": 40, "has_bug": False}])
        feedback = [m for m in board.messages if m.kind is main.MsgKind.REVIEW_FEEDBACK]
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0].to, "coder-A")
        self.assertEqual(feedback[0].payload, {"comment": "fix cache"})
        self.assertEqual(
            [m.kind for m in board.messages][-3:],
            [main.MsgKind.DIFF_READY, main.MsgKind.APPROVED, main.MsgKind.TEST_FAILED],
        )
        self.assertEqual(result["handoffs"], 8)
        self.assertEqual(result["total_tokens"], 19900)
        self.assertFalse(result["approved"])
        self.assertFalse(result["tested_passed"])


class TestSingleAgentBaseline(unittest.TestCase):
    def test_pass_threshold_and_token_budget_are_rng_driven(self):
        passing_rng = Mock(spec=random.Random)
        passing_rng.random.return_value = 0.679
        passing_rng.randint.return_value = 6000
        self.assertEqual(
            main.single_agent_baseline("issue-pass", passing_rng),
            {"passed": True, "total_tokens": 24000},
        )
        passing_rng.random.assert_called_once_with()
        passing_rng.randint.assert_called_once_with(0, 6000)

        boundary_rng = Mock(spec=random.Random)
        boundary_rng.random.return_value = 0.68
        boundary_rng.randint.return_value = 0
        self.assertEqual(
            main.single_agent_baseline("issue-fail", boundary_rng),
            {"passed": False, "total_tokens": 18000},
        )


if __name__ == "__main__":
    unittest.main()
