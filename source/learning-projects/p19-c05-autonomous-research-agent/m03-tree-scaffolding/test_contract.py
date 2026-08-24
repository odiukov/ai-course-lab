import io
import random
import unittest
from unittest import mock

import main


class TestExpand(unittest.TestCase):
    def test_children_are_deterministic_small_edits(self):
        original = {"sparsity_top": 4, "lr": 3e-4, "batch_size": 32}
        parent = main.Node(7, 2, "parent", dict(original))

        children = main.expand(parent, 10)

        self.assertEqual(parent.config, original)
        self.assertEqual([child.node_id for child in children], [10, 11, 12, 13, 14])
        self.assertEqual([child.parent for child in children], [7] * 5)
        self.assertEqual(
            [child.hypothesis for child in children],
            ["sparsity top-4", "sparsity top-8", "sparsity top-16", "lr=0.0003", "lr=0.001"],
        )
        self.assertEqual(
            [child.config for child in children],
            [
                {"sparsity_top": 4, "lr": 3e-4, "batch_size": 32},
                {"sparsity_top": 8, "lr": 3e-4, "batch_size": 32},
                {"sparsity_top": 16, "lr": 3e-4, "batch_size": 32},
                {"sparsity_top": 4, "lr": 3e-4, "batch_size": 32},
                {"sparsity_top": 4, "lr": 1e-3, "batch_size": 32},
            ],
        )
        self.assertTrue(all(child.config is not parent.config for child in children))
        for child in children:
            changed = {key for key in original if child.config[key] != original[key]}
            self.assertLessEqual(len(changed), 1)
            self.assertTrue(changed <= {"sparsity_top", "lr"})


class TestNodeScore(unittest.TestCase):
    def test_weighted_score_and_budget_cap(self):
        node = main.Node(
            node_id=1,
            parent=0,
            hypothesis="candidate",
            config={},
            novelty=0.75,
            quality=0.4,
            cost_usd=99.0,
            failure="ignored-by-score",
        )

        self.assertAlmostEqual(node.score(0.0), 0.50)
        self.assertAlmostEqual(node.score(5.0), 0.55)
        self.assertAlmostEqual(node.score(10.0), 0.60)
        self.assertAlmostEqual(node.score(100.0), 0.60)


class MidpointRng:
    def gauss(self, mean, deviation):
        if (mean, deviation) != (0, 0.05):
            raise AssertionError("unexpected Gaussian parameters")
        return 0.0

    def uniform(self, lower, upper):
        return (lower + upper) / 2

    def random(self):
        return 0.5


class FailureRng(MidpointRng):
    def random(self):
        return 0.05


class TestRunExperiment(unittest.TestCase):
    def test_populates_reproducible_metrics_cost_and_scores(self):
        node = main.Node(3, 0, "trial", {"sparsity_top": 4, "lr": 1e-3})

        result = main.run_experiment(node, MidpointRng())

        self.assertIsNone(result)
        self.assertEqual(node.result, {"loss": 2.775, "sparsity_top": 4, "lr": 1e-3})
        self.assertAlmostEqual(node.cost_usd, 1.4)
        self.assertAlmostEqual(node.quality, 0.81662, places=6)
        self.assertAlmostEqual(node.novelty, 0.55)
        self.assertIsNone(node.failure)

    def test_records_simulated_cgroup_failure(self):
        node = main.Node(4, 0, "risky", {})

        main.run_experiment(node, FailureRng())

        self.assertTrue(node.result)
        self.assertGreater(node.cost_usd, 0.0)
        self.assertEqual(node.failure, "oom_killed_by_cgroup")
        self.assertEqual(node.quality, 0.0)


class TestTreeSearch(unittest.TestCase):
    def test_orchestrates_execution_verification_and_failure_pruning(self):
        def fake_expand(node, next_id):
            if node.node_id == 0:
                return [
                    main.Node(next_id, 0, "rejected", {"x": 1}),
                    main.Node(next_id + 1, 0, "accepted", {"x": 2}),
                ]
            return []

        def fake_run(node, rng):
            node.result = {"loss": 3.0}
            node.cost_usd = 2.0
            node.quality = 0.5

        def fake_verify(node):
            if node.node_id == 1:
                node.failure = "rejected_by_verifier"
                return False
            return True

        with mock.patch.object(main, "expand", side_effect=fake_expand) as expand_mock, mock.patch.object(main, "run_experiment", side_effect=fake_run) as run_mock, mock.patch.object(main, "verify", side_effect=fake_verify) as verify_mock, mock.patch.object(main.Node, "score", return_value=0.5), mock.patch("sys.stdout", new=io.StringIO()):
            tree = main.tree_search("seed hypothesis", random.Random(123))

        self.assertEqual(tree.root.hypothesis, "seed hypothesis")
        self.assertEqual(tree.root.config, {"sparsity_top": 8, "lr": 3e-4})
        self.assertEqual(set(tree.nodes), {0, 1, 2})
        self.assertAlmostEqual(tree.spent, 4.0)
        self.assertEqual(tree.nodes[1].failure, "rejected_by_verifier")
        self.assertIsNone(tree.nodes[2].failure)
        self.assertEqual([call.args[0].node_id for call in run_mock.call_args_list], [1, 2])
        self.assertEqual([call.args[0].node_id for call in verify_mock.call_args_list], [1, 2])
        self.assertEqual([call.args[0].node_id for call in expand_mock.call_args_list], [0, 2])
        self.assertEqual([call.args[1] for call in expand_mock.call_args_list], [1, 3])


class TestVerify(unittest.TestCase):
    def test_rejects_existing_failures_without_overwriting_reason(self):
        node = main.Node(1, 0, "failed", {}, result={"loss": 2.0}, failure="sandbox_timeout")

        self.assertFalse(main.verify(node))
        self.assertEqual(node.failure, "sandbox_timeout")

    def test_enforces_loss_threshold_and_marks_divergence(self):
        boundary = main.Node(2, 0, "boundary", {}, result={"loss": 4.0})
        divergent = main.Node(3, 0, "divergent", {}, result={"loss": 4.001})
        missing = main.Node(4, 0, "missing", {})

        self.assertTrue(main.verify(boundary))
        self.assertIsNone(boundary.failure)
        self.assertFalse(main.verify(divergent))
        self.assertEqual(divergent.failure, "loss_diverged")
        self.assertFalse(main.verify(missing))
        self.assertEqual(missing.failure, "loss_diverged")


class TestBestBranch(unittest.TestCase):
    def test_selects_best_successful_node_and_reconstructs_ancestry(self):
        root = main.Node(0, None, "root", {})
        middle = main.Node(1, 0, "middle", {}, result={"loss": 3.0}, quality=0.4)
        best = main.Node(2, 1, "best", {}, result={"loss": 2.6}, quality=0.9)
        alternate = main.Node(3, 0, "alternate", {}, result={"loss": 2.8}, quality=0.7)
        failed = main.Node(4, 0, "failed", {}, result={"loss": 2.0}, quality=1.0, failure="oom")
        unexecuted = main.Node(5, 0, "unexecuted", {}, quality=2.0)
        tree = main.Tree(root=root, nodes={n.node_id: n for n in [root, middle, best, alternate, failed, unexecuted]})

        branch = main.best_branch(tree)

        self.assertEqual([node.node_id for node in branch], [0, 1, 2])
        self.assertIs(branch[0], root)
        self.assertIs(branch[-1], best)

    def test_returns_empty_branch_without_successful_results(self):
        root = main.Node(0, None, "root", {})
        failed = main.Node(1, 0, "failed", {}, result={"loss": 3.0}, failure="timeout")
        tree = main.Tree(root=root, nodes={0: root, 1: failed})

        self.assertEqual(main.best_branch(tree), [])


class TestMain(unittest.TestCase):
    def test_runs_seeded_search_and_prints_summary(self):
        root = main.Node(0, None, "seed", {})
        failed = main.Node(1, 0, "failed", {}, failure="oom")
        chosen = main.Node(2, 0, "chosen", {}, result={"loss": 2.7}, quality=0.8)
        fake_tree = main.Tree(root=root, nodes={0: root, 1: failed}, spent=3.25, budget=30.0)
        output = io.StringIO()

        with mock.patch.object(main, "tree_search", return_value=fake_tree) as search_mock, mock.patch.object(main, "best_branch", return_value=[root, chosen]) as branch_mock, mock.patch("sys.stdout", new=output):
            returned = main.main()

        self.assertIsNone(returned)
        search_mock.assert_called_once()
        seed, rng = search_mock.call_args.args
        self.assertEqual(seed, "investigate sparsity patterns in attention maps of sub-1B transformers")
        self.assertIsInstance(rng, random.Random)
        self.assertAlmostEqual(rng.random(), random.Random(7).random())
        branch_mock.assert_called_once_with(fake_tree)
        rendered = output.getvalue()
        self.assertIn("nodes explored : 2", rendered)
        self.assertIn("budget spent   : $3.25 of $30.00", rendered)
        self.assertIn("failed nodes   : 1", rendered)
        self.assertIn("best branch (length 2):", rendered)
        self.assertIn("#02 chosen", rendered)
        self.assertIn("loss=2.7", rendered)
        self.assertIn("writer + reviewer + red-team steps would run here", rendered)


if __name__ == "__main__":
    unittest.main()
