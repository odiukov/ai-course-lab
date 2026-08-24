import contextlib
import io
import unittest
from unittest.mock import Mock, patch

import main


class TestInstallationTokenMint(unittest.TestCase):
    @patch("main.time.time", return_value=125.0)
    def test_mint_scopes_repo_lifetime_and_permissions(self, clock):
        token = main.InstallationToken.mint("acme/widget")

        self.assertEqual(token.repo, "acme/widget")
        self.assertEqual(token.expires_at, 3725.0)
        self.assertEqual(
            token.permissions,
            {
                "issues": "rw",
                "pull_requests": "rw",
                "contents": "rw",
                "workflows": "r",
            },
        )
        clock.assert_called_once_with()


class TestInstallationTokenCan(unittest.TestCase):
    def test_denies_protected_writes_and_allows_normal_operations(self):
        token = main.InstallationToken(
            repo="acme/widget",
            expires_at=9999.0,
            permissions={"pull_requests": "rw"},
        )

        cases = {
            "force_push": False,
            "write:main": False,
            "write:main:commit": False,
            "pull_request.open": True,
            "push:agent-branch": True,
        }
        for action, expected in cases.items():
            with self.subTest(action=action):
                self.assertIs(token.can(action), expected)


class TestBudgetLedgerPermit(unittest.TestCase):
    def test_enforces_task_daily_and_pr_boundaries_without_recording(self):
        ledger = main.BudgetLedger(
            daily_dollar_cap=50.0,
            daily_pr_cap=5,
            per_task_dollar_cap=20.0,
        )

        allowed, reason = ledger.permit("acme/widget", 20.0)
        self.assertTrue(allowed)
        self.assertEqual(reason, "ok")
        self.assertEqual(ledger.spent_today["acme/widget"], 0.0)
        self.assertEqual(ledger.prs_today["acme/widget"], 0)

        allowed, reason = ledger.permit("acme/widget", 20.01)
        self.assertFalse(allowed)
        self.assertIn("task estimate", reason)

        ledger.spent_today["acme/widget"] = 30.0
        self.assertEqual(ledger.permit("acme/widget", 1.0), (True, "ok"))

        ledger.spent_today["acme/widget"] = 30.01
        allowed, reason = ledger.permit("acme/widget", 1.0)
        self.assertFalse(allowed)
        self.assertIn("daily $ cap", reason)

        ledger.spent_today["acme/widget"] = 0.0
        ledger.prs_today["acme/widget"] = 5
        allowed, reason = ledger.permit("acme/widget", 1.0)
        self.assertFalse(allowed)
        self.assertIn("daily PR cap (5)", reason)


class TestDispatch(unittest.TestCase):
    def test_denied_task_stops_before_token_and_worker(self):
        task = main.Task(7, "acme/widget", 807, "fix bug")
        ledger = Mock()
        ledger.permit.return_value = (False, "quota exhausted")
        rng = Mock()
        rng.uniform.return_value = 0.5

        with patch.object(main.InstallationToken, "mint") as mint, \
             patch("main.run_agent") as run_agent, \
             patch("main.run_verify") as run_verify, \
             patch("main.open_pr") as open_pr:
            run = main.dispatch(task, ledger, rng)

        self.assertIs(run.task, task)
        self.assertEqual(run.state, main.SState.FAILED)
        self.assertEqual(run.failure, "dispatcher: quota exhausted")
        ledger.permit.assert_called_once_with("acme/widget", 6.0)
        ledger.record.assert_not_called()
        mint.assert_not_called()
        run_agent.assert_not_called()
        run_verify.assert_not_called()
        open_pr.assert_not_called()

    def test_allowed_task_runs_ordered_gates_and_records_actual_result(self):
        task = main.Task(8, "acme/service", 808, "repair parser")
        ledger = Mock()
        ledger.permit.return_value = (True, "ok")
        rng = Mock()
        rng.uniform.return_value = 0.5
        token = object()
        events = []

        def fake_agent(run, difficulty, received_rng):
            events.append("agent")
            self.assertEqual(run.state, main.SState.INFER)
            self.assertEqual(difficulty, 0.5)
            self.assertIs(received_rng, rng)
            run.turns = 3
            run.dollars = 4.25
            run.state = main.SState.VERIFY

        def fake_verify(run, difficulty, received_rng):
            events.append("verify")
            self.assertEqual(difficulty, 0.5)
            self.assertIs(received_rng, rng)
            run.ci_green = True
            run.state = main.SState.PR

        def fake_open(run, received_token):
            events.append("pr")
            self.assertIs(received_token, token)
            run.pr_opened = True
            run.state = main.SState.DONE

        with patch.object(main.InstallationToken, "mint", return_value=token) as mint, \
             patch("main.run_agent", side_effect=fake_agent) as run_agent, \
             patch("main.run_verify", side_effect=fake_verify) as run_verify, \
             patch("main.open_pr", side_effect=fake_open) as open_pr:
            run = main.dispatch(task, ledger, rng)

        self.assertEqual(events, ["agent", "verify", "pr"])
        self.assertEqual(run.state, main.SState.DONE)
        self.assertTrue(run.pr_opened)
        self.assertEqual(
            run.trace,
            ["state: CLONE", "state: INFER (dockerfile synthesized)"],
        )
        ledger.permit.assert_called_once_with("acme/service", 6.0)
        ledger.record.assert_called_once_with("acme/service", 4.25, True)
        mint.assert_called_once_with("acme/service")
        self.assertEqual(run_agent.call_count, 1)
        self.assertEqual(run_verify.call_count, 1)
        self.assertEqual(open_pr.call_count, 1)


class TestRunAgent(unittest.TestCase):
    def test_successful_turn_transitions_to_verification(self):
        run = main.SandboxRun(main.Task(1, "acme/widget", 1, "fix"))
        rng = Mock()
        rng.random.return_value = 0.0

        main.run_agent(run, difficulty=0.5, rng=rng)

        self.assertEqual(run.state, main.SState.VERIFY)
        self.assertIsNone(run.failure)
        self.assertEqual(run.turns, 1)
        self.assertAlmostEqual(run.wall_min, 1.2)
        self.assertAlmostEqual(run.dollars, 0.475)
        self.assertEqual(len(run.trace), 1)
        self.assertTrue(run.trace[0].startswith("turn 1: $="))
        rng.random.assert_called_once_with()

    def test_turn_limit_precedes_success_sampling(self):
        run = main.SandboxRun(main.Task(2, "acme/widget", 2, "fix"))
        rng = Mock()

        main.run_agent(run, 0.0, rng, turn_cap=1, dollar_cap=99, minute_cap=99)

        self.assertEqual(run.state, main.SState.FAILED)
        self.assertEqual(run.failure, "turn_cap")
        self.assertEqual(run.turns, 1)
        rng.random.assert_not_called()

    def test_dollar_limit_is_inclusive(self):
        run = main.SandboxRun(main.Task(3, "acme/widget", 3, "fix"))
        rng = Mock()

        main.run_agent(run, 0.0, rng, turn_cap=5, dollar_cap=0.25, minute_cap=99)

        self.assertEqual(run.state, main.SState.FAILED)
        self.assertEqual(run.failure, "dollar_cap")
        self.assertEqual(run.dollars, 0.25)
        rng.random.assert_not_called()

    def test_minute_limit_is_inclusive(self):
        run = main.SandboxRun(main.Task(4, "acme/widget", 4, "fix"))
        rng = Mock()

        main.run_agent(run, 0.0, rng, turn_cap=5, dollar_cap=99, minute_cap=0.9)

        self.assertEqual(run.state, main.SState.FAILED)
        self.assertEqual(run.failure, "minute_cap")
        self.assertEqual(run.wall_min, 0.9)
        rng.random.assert_not_called()


class TestRunVerify(unittest.TestCase):
    def test_flake_fails_without_computing_coverage(self):
        run = main.SandboxRun(
            main.Task(10, "acme/widget", 10, "fix"), state=main.SState.VERIFY
        )
        rng = Mock()
        rng.random.return_value = 0.01

        main.run_verify(run, 0.5, rng)

        self.assertFalse(run.ci_green)
        self.assertEqual(run.failure, "flaky_test")
        self.assertEqual(run.state, main.SState.FAILED)
        rng.gauss.assert_not_called()

    def test_coverage_regression_fails_after_green_ci(self):
        run = main.SandboxRun(
            main.Task(11, "acme/widget", 11, "fix"), state=main.SState.VERIFY
        )
        rng = Mock()
        rng.random.return_value = 0.5
        rng.gauss.return_value = -2.01

        main.run_verify(run, 0.8, rng)

        self.assertTrue(run.ci_green)
        self.assertEqual(run.coverage_delta, -2.01)
        self.assertEqual(run.failure, "coverage_regression")
        self.assertEqual(run.state, main.SState.FAILED)
        rng.gauss.assert_called_once_with(0.0, 0.6)

    def test_green_ci_with_boundary_coverage_advances_to_pr(self):
        run = main.SandboxRun(
            main.Task(12, "acme/widget", 12, "fix"), state=main.SState.VERIFY
        )
        rng = Mock()
        rng.random.return_value = 0.5
        rng.gauss.return_value = -2.0

        main.run_verify(run, 0.8, rng)

        self.assertTrue(run.ci_green)
        self.assertEqual(run.coverage_delta, -2.0)
        self.assertIsNone(run.failure)
        self.assertEqual(run.state, main.SState.PR)


class TestOpenPr(unittest.TestCase):
    @patch("main.time.time", return_value=100.0)
    def test_expiration_boundary_is_rejected_before_policy_check(self, _clock):
        run = main.SandboxRun(
            main.Task(20, "acme/widget", 20, "fix"), state=main.SState.PR
        )
        token = Mock()
        token.expires_at = 100.0

        main.open_pr(run, token)

        self.assertFalse(run.pr_opened)
        self.assertEqual(run.failure, "token_expired")
        self.assertEqual(run.state, main.SState.FAILED)
        token.can.assert_not_called()

    @patch("main.time.time", return_value=100.0)
    def test_live_but_denied_token_is_rejected(self, _clock):
        run = main.SandboxRun(
            main.Task(21, "acme/widget", 21, "fix"), state=main.SState.PR
        )
        token = Mock()
        token.expires_at = 101.0
        token.can.return_value = False

        main.open_pr(run, token)

        self.assertFalse(run.pr_opened)
        self.assertEqual(run.failure, "policy_denied")
        self.assertEqual(run.state, main.SState.FAILED)
        token.can.assert_called_once_with("pull_request.open")

    @patch("main.time.time", return_value=100.0)
    def test_live_authorized_token_opens_pr(self, _clock):
        run = main.SandboxRun(
            main.Task(22, "acme/widget", 22, "fix"), state=main.SState.PR
        )
        token = Mock()
        token.expires_at = 101.0
        token.can.return_value = True

        main.open_pr(run, token)

        self.assertTrue(run.pr_opened)
        self.assertIsNone(run.failure)
        self.assertEqual(run.state, main.SState.DONE)
        token.can.assert_called_once_with("pull_request.open")


class TestMain(unittest.TestCase):
    def test_demo_dispatches_twenty_seeded_tasks_and_reports_aggregates(self):
        repos = ["acme/widget", "acme/service", "acme/library"]

        class FakeRng:
            def __init__(self):
                self.index = 0

            def choice(self, choices):
                if list(choices) != repos:
                    raise AssertionError("unexpected repository choices")
                value = repos[self.index % len(repos)]
                self.index += 1
                return value

        fake_rng = FakeRng()

        def fake_dispatch(task, ledger, received_rng):
            self.assertIs(received_rng, fake_rng)
            ledger.record(task.repo, 2.5, True)
            return main.SandboxRun(
                task=task,
                state=main.SState.DONE,
                turns=5,
                dollars=2.5,
                ci_green=True,
                pr_opened=True,
            )

        output = io.StringIO()
        with patch("main.random.Random", return_value=fake_rng) as random_class, \
             patch("main.dispatch", side_effect=fake_dispatch) as dispatch_mock, \
             contextlib.redirect_stdout(output):
            result = main.main()

        self.assertIsNone(result)
        random_class.assert_called_once_with(9)
        self.assertEqual(dispatch_mock.call_count, 20)
        tasks = [entry.args[0] for entry in dispatch_mock.call_args_list]
        self.assertEqual([task.task_id for task in tasks], list(range(20)))
        self.assertEqual([task.issue_num for task in tasks], list(range(800, 820)))
        self.assertEqual(
            [task.title for task in tasks],
            [f"fix NPE in module {i}" for i in range(20)],
        )
        self.assertTrue(all(task.repo in repos for task in tasks))

        rendered = output.getvalue()
        self.assertIn("=== dispatch result (20 tasks) ===", rendered)
        self.assertIn("PRs opened : 20", rendered)
        self.assertIn("failed     : 0", rendered)
        self.assertIn("budget summary:", rendered)
        self.assertIn("mean $/PR = $2.50  mean turns = 5.0", rendered)


if __name__ == "__main__":
    unittest.main()
