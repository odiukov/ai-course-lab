import unittest
from types import SimpleNamespace
from unittest.mock import patch

import main


class TestCurriculumMap(unittest.TestCase):
    def test_builds_name_index_and_last_duplicate_wins(self):
        first = main.Concept("numbers", [])
        algebra = main.Concept("algebra", ["numbers"])
        replacement = main.Concept("numbers", ["counting"])

        result = main.curriculum_map([first, algebra, replacement])

        self.assertEqual(list(result), ["numbers", "algebra"])
        self.assertIs(result["numbers"], replacement)
        self.assertIs(result["algebra"], algebra)
        self.assertEqual(main.curriculum_map([]), {})


class TestBKTUpdate(unittest.TestCase):
    def test_applies_bayesian_evidence_then_learning_transition(self):
        params = main.BKTParams(p_init=0.2, p_learn=0.1, p_slip=0.1, p_guess=0.2)
        mastery = 0.4

        correct_posterior = (mastery * 0.9) / (mastery * 0.9 + (1 - mastery) * 0.2)
        incorrect_posterior = (mastery * 0.1) / (mastery * 0.1 + (1 - mastery) * 0.8)

        self.assertAlmostEqual(
            main.bkt_update(mastery, True, params),
            correct_posterior + (1 - correct_posterior) * 0.1,
        )
        self.assertAlmostEqual(
            main.bkt_update(mastery, False, params),
            incorrect_posterior + (1 - incorrect_posterior) * 0.1,
        )
        self.assertAlmostEqual(main.bkt_update(0.0, True, params), params.p_learn)
        self.assertAlmostEqual(main.bkt_update(1.0, False, params), 1.0)


class TestNextConcept(unittest.TestCase):
    def test_selects_first_unmastered_concept_with_mastered_prerequisites(self):
        cmap = {
            "done": main.Concept("done", []),
            "blocked": main.Concept("blocked", ["missing"]),
            "ready": main.Concept("ready", ["done"]),
        }
        state = main.LearnerState(
            "learner",
            mastery={"done": 0.85, "blocked": 0.1, "missing": 0.84, "ready": 0.2},
        )

        self.assertEqual(main.next_concept(state, cmap), "ready")

        state.mastery["ready"] = 0.85
        state.mastery["missing"] = 0.85
        self.assertEqual(main.next_concept(state, cmap), "blocked")

        state.mastery["blocked"] = 0.85
        self.assertIsNone(main.next_concept(state, cmap))


class TestSocraticPolicy(unittest.TestCase):
    def test_covers_correctness_mastery_branches_and_boundaries(self):
        state = main.LearnerState("learner", mastery={"topic": 0.81})
        self.assertEqual(main.socratic_policy(state, "topic", True), "celebrate_and_advance")

        state.mastery["topic"] = 0.8
        self.assertEqual(main.socratic_policy(state, "topic", True), "reinforce_and_next_question")

        state.mastery["topic"] = 0.6
        self.assertEqual(main.socratic_policy(state, "topic", False), "hint")

        state.mastery["topic"] = 0.5
        self.assertEqual(main.socratic_policy(state, "topic", False), "scaffold_from_prereq")


class TestRunAdaptive(unittest.TestCase):
    def test_threads_policy_actions_into_later_turns(self):
        cmap = {"focus": SimpleNamespace(prereqs=["prereq"])}
        simulated = []
        updates = []
        actions = iter([
            "scaffold_from_prereq",
            "hint",
            "celebrate_and_advance",
            "reinforce_and_next_question",
        ])

        def fake_simulate(knowledge, difficulty, rng):
            simulated.append((knowledge, difficulty))
            return True

        def fake_update(mastery, correct, params):
            updates.append((mastery, correct))
            return mastery + 0.1

        with patch("main.next_concept", side_effect=lambda state, graph: "focus"), \
             patch("main.simulate_answer", side_effect=fake_simulate), \
             patch("main.socratic_policy", side_effect=lambda state, concept, correct: next(actions)), \
             patch("main.bkt_update", side_effect=fake_update):
            state = main.run_adaptive("adaptive-1", 0.3, cmap, 4, main.random.Random(7))

        self.assertEqual(state.learner_id, "adaptive-1")
        self.assertEqual(state.history, [("focus", True)] * 4)
        self.assertEqual(len(simulated), 4)
        for actual, expected in zip([x[1] for x in simulated], [0.4, 0.25, 0.32, 0.4]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip([x[0] for x in simulated], [0.6, 0.75, 0.9, 1.08]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip([x[0] for x in updates], [0.2, 0.3, 0.4, 0.52]):
            self.assertAlmostEqual(actual, expected)
        self.assertTrue(all(correct for _, correct in updates))
        self.assertAlmostEqual(state.mastery["focus"], 0.62)


class TestRunBaseline(unittest.TestCase):
    def test_uses_round_robin_without_adaptive_scaffolding(self):
        cmap = {
            "a": SimpleNamespace(prereqs=[]),
            "b": SimpleNamespace(prereqs=["x", "y"]),
        }
        simulated = []

        def fake_simulate(knowledge, difficulty, rng):
            simulated.append((knowledge, difficulty))
            return difficulty < 0.4

        def fake_update(mastery, correct, params):
            return mastery + (0.2 if correct else 0.05)

        with patch("main.simulate_answer", side_effect=fake_simulate), \
             patch("main.bkt_update", side_effect=fake_update):
            state = main.run_baseline("baseline-1", 0.1, cmap, 5, main.random.Random(9))

        self.assertEqual(state.learner_id, "baseline-1")
        self.assertEqual(
            state.history,
            [("a", True), ("b", False), ("a", True), ("b", False), ("a", True)],
        )
        for actual, expected in zip([x[1] for x in simulated], [0.3, 0.5, 0.3, 0.5, 0.3]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip([x[0] for x in simulated], [0.4, 0.4, 0.7, 0.475, 1.0]):
            self.assertAlmostEqual(actual, expected)
        self.assertAlmostEqual(state.mastery["a"], 0.8)
        self.assertAlmostEqual(state.mastery["b"], 0.3)
