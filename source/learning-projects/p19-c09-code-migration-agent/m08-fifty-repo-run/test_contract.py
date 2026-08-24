import contextlib
import io
import random
import unittest
from unittest import mock

import main


class FixedRng:
    def __init__(self, random_values=(), gauss_value=0.0):
        self._values = iter(random_values)
        self.gauss_value = gauss_value

    def random(self):
        return next(self._values)

    def gauss(self, mu, sigma):
        return self.gauss_value


class TestRunRecipes(unittest.TestCase):
    def test_rewrite_count_uses_size_and_hardness(self):
        cases = [
            (main.Repo("small", 1000, "java", 0.0), 22),
            (main.Repo("hard", 1000, "python", 1.0), 17),
            (main.Repo("large", 40000, "java", 0.5), 90),
        ]
        for repo, expected in cases:
            with self.subTest(repo=repo.name):
                result = main.run_recipes(repo)
                self.assertEqual(result, expected)
                self.assertIs(type(result), int)


class TestMigrate(unittest.TestCase):
    def test_straight_through_records_recipe_and_skips_agent(self):
        repo = main.Repo("easy", 1200, "python", 0.0)
        rng = FixedRng([0.0, 0.5], gauss_value=0.25)

        with mock.patch.object(main, "run_recipes", return_value=7) as recipes, \
             mock.patch.object(main, "agent_loop") as agent:
            attempt = main.migrate(repo, rng)

        recipes.assert_called_once_with(repo)
        agent.assert_not_called()
        self.assertIs(attempt.repo, repo)
        self.assertEqual(attempt.recipe_applied, 7)
        self.assertEqual(attempt.status, "pass")
        self.assertEqual(attempt.cost_usd, 0.30)
        self.assertAlmostEqual(attempt.wall_min, 5.0)
        self.assertAlmostEqual(attempt.coverage_final, 80.25)

    def test_failed_recipe_path_invokes_agent_after_recipe(self):
        repo = main.Repo("needs-agent", 5000, "java", 0.8)
        rng = FixedRng([1.0])
        events = []

        def recipe_pass(actual_repo):
            events.append(("recipe", actual_repo))
            return 11

        def agent_pass(attempt, actual_rng):
            events.append(("agent", attempt.recipe_applied, actual_rng))
            attempt.agent_turns = 2
            attempt.status = "pass"

        with mock.patch.object(main, "run_recipes", side_effect=recipe_pass), \
             mock.patch.object(main, "agent_loop", side_effect=agent_pass):
            attempt = main.migrate(repo, rng)

        self.assertEqual(events[0], ("recipe", repo))
        self.assertEqual(events[1], ("agent", 11, rng))
        self.assertEqual(attempt.recipe_applied, 11)
        self.assertEqual(attempt.agent_turns, 2)
        self.assertEqual(attempt.status, "pass")


class TestAgentLoop(unittest.TestCase):
    def test_successful_turn_updates_usage_and_coverage(self):
        repo = main.Repo("fixable", 2000, "java", 0.5)
        attempt = main.Attempt(repo=repo)
        rng = FixedRng([0.0], gauss_value=-0.5)

        result = main.agent_loop(attempt, rng)

        self.assertIsNone(result)
        self.assertEqual(attempt.status, "pass")
        self.assertIsNone(attempt.failure_class)
        self.assertEqual(attempt.agent_turns, 1)
        self.assertAlmostEqual(attempt.wall_min, 3.8)
        self.assertAlmostEqual(attempt.cost_usd, 0.775)
        self.assertAlmostEqual(attempt.coverage_final, 79.5)

    def test_turn_limit_stops_without_another_model_call(self):
        repo = main.Repo("capped", 2000, "python", 0.4)
        attempt = main.Attempt(repo=repo, agent_turns=main.BUDGET_TURNS)
        rng = mock.Mock()

        main.agent_loop(attempt, rng)

        self.assertEqual(attempt.status, "fail")
        self.assertEqual(attempt.failure_class, "budget_exhausted")
        self.assertEqual(attempt.agent_turns, main.BUDGET_TURNS)
        rng.random.assert_not_called()
        rng.gauss.assert_not_called()


class TestClassifyFailure(unittest.TestCase):
    def test_probability_intervals_map_to_normalized_taxonomy(self):
        cases = [
            (0.10, "dep_upgrade_required"),
            (0.40, "build_tool_drift"),
            (0.60, "custom_annotation"),
            (0.75, "test_flake"),
            (0.90, "syntax_edge_case"),
        ]
        for sample, expected in cases:
            with self.subTest(sample=sample):
                rng = FixedRng([sample])
                self.assertEqual(main.classify_failure(rng), expected)


class TestSynthBench(unittest.TestCase):
    def test_seeded_benchmark_has_fifty_valid_repositories(self):
        first = main.synth_bench(random.Random(19))
        second = main.synth_bench(random.Random(19))

        self.assertEqual(first, second)
        self.assertEqual(len(first), 50)
        self.assertEqual([r.name for r in first], [
            f"repo-{i:02d}-{r.lang}" for i, r in enumerate(first)
        ])
        self.assertEqual({r.lang for r in first}, {"java", "python"})
        self.assertTrue(all(800 <= r.loc <= 40000 for r in first))
        self.assertTrue(all(0.05 <= r.hardness <= 0.95 for r in first))


class TestMain(unittest.TestCase):
    def test_prints_aggregate_results_from_pipeline_attempts(self):
        passed_repo = main.Repo("passed", 1000, "java", 0.2)
        failed_repo = main.Repo("failed", 1000, "python", 0.9)
        passed = main.Attempt(
            repo=passed_repo,
            status="pass",
            recipe_applied=5,
            agent_turns=2,
            cost_usd=1.5,
            wall_min=4.0,
            coverage_base=80.0,
            coverage_final=80.5,
        )
        failed = main.Attempt(
            repo=failed_repo,
            status="fail",
            failure_class="build_tool_drift",
        )

        output = io.StringIO()
        with mock.patch.object(main, "synth_bench", return_value=[passed_repo, failed_repo]) as bench, \
             mock.patch.object(main, "migrate", side_effect=[passed, failed]) as migrate, \
             contextlib.redirect_stdout(output):
            result = main.main()

        text = output.getvalue()
        self.assertIsNone(result)
        bench.assert_called_once()
        self.assertEqual(migrate.call_count, 2)
        self.assertIn("migration-bench run (50 repos)", text)
        self.assertIn("passed :  1", text)
        self.assertIn("failed :  1", text)
        self.assertIn("build_tool_drift", text)
        self.assertIn("$1.50", text)
        self.assertIn("+0.50 points", text)


if __name__ == "__main__":
    unittest.main()
