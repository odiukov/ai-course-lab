import io
import re
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest import mock

import main


class TestBuildIndex(unittest.TestCase):
    def test_builds_every_corpus_page_and_prunes_embeddings(self):
        def fake_embed(page):
            page.patches = [[float(page.page_num)], [-float(page.page_num)]]

        def fake_prune(patches, keep_fraction=0.5):
            self.assertEqual(keep_fraction, 0.5)
            return patches[:1]

        with mock.patch.object(main.Page, "embed_patches", autospec=True, side_effect=fake_embed) as embed:
            with mock.patch.object(main, "doc_prune", side_effect=fake_prune) as prune:
                index = main.build_index(prune=True)

        self.assertIsInstance(index, main.Index)
        self.assertEqual(len(index.pages), len(main.CORPUS))
        self.assertEqual(embed.call_count, len(main.CORPUS))
        self.assertEqual(prune.call_count, len(main.CORPUS))

        for page, (doc_id, page_num, text) in zip(index.pages, main.CORPUS):
            self.assertEqual(page.doc_id, doc_id)
            self.assertEqual(page.page_num, page_num)
            self.assertEqual(page.content_tokens, re.findall(r"\w+", text.lower()))
            self.assertEqual(page.patches, [[float(page_num)]])

    def test_pruning_can_be_disabled(self):
        def fake_embed(page):
            page.patches = [[1.0], [2.0]]

        with mock.patch.object(main.Page, "embed_patches", autospec=True, side_effect=fake_embed):
            with mock.patch.object(main, "doc_prune") as prune:
                index = main.build_index(prune=False)

        prune.assert_not_called()
        self.assertEqual(len(index.pages), len(main.CORPUS))
        self.assertTrue(all(page.patches == [[1.0], [2.0]] for page in index.pages))


class TestPageEmbedPatches(unittest.TestCase):
    def test_embeds_each_content_token_in_order_and_replaces_old_patches(self):
        page = main.Page("doc", 7, ["alpha", "beta", "alpha"], patches=[[99.0]])
        vectors = {"alpha": [1.0, 0.0], "beta": [0.0, 1.0]}

        with mock.patch.object(main, "hash_embed", side_effect=lambda token: vectors[token]) as embed:
            result = page.embed_patches()

        self.assertIsNone(result)
        self.assertEqual(page.patches, [[1.0, 0.0], [0.0, 1.0], [1.0, 0.0]])
        self.assertEqual(embed.call_args_list, [mock.call("alpha"), mock.call("beta"), mock.call("alpha")])


class TestDocPrune(unittest.TestCase):
    def test_keeps_requested_fraction_with_highest_l1_signal(self):
        patches = [[0.1, 0.0], [-3.0, 0.0], [1.0, 1.0], [0.0, 0.5]]
        original = [patch[:] for patch in patches]

        kept = main.doc_prune(patches, keep_fraction=0.5)

        self.assertEqual(kept, [[-3.0, 0.0], [1.0, 1.0]])
        self.assertIs(kept[0], patches[1])
        self.assertIs(kept[1], patches[2])
        self.assertEqual(patches, original)

    def test_keeps_at_least_one_nonempty_patch_and_handles_empty_input(self):
        patches = [[0.2], [4.0], [1.0]]
        self.assertEqual(main.doc_prune(patches, keep_fraction=0.0), [[4.0]])
        self.assertEqual(main.doc_prune([], keep_fraction=0.5), [])


class TestMaxSimScore(unittest.TestCase):
    def test_sums_best_patch_similarity_for_each_query_token(self):
        query_tokens = [[1.0, 0.0], [0.0, 2.0]]
        doc_patches = [[1.0, 0.0], [0.0, 1.0], [-1.0, 0.0]]
        self.assertAlmostEqual(main.max_sim_score(query_tokens, doc_patches), 3.0)

    def test_preserves_negative_maxima_and_empty_query_identity(self):
        self.assertAlmostEqual(main.max_sim_score([[1.0]], [[-2.0], [-0.5]]), -0.5)
        self.assertEqual(main.max_sim_score([], [[3.0]]), 0.0)


class TestIndexRetrieve(unittest.TestCase):
    def test_encodes_query_scores_every_page_and_returns_descending_top_k(self):
        low = main.Page("low", 1, [], patches=[[10.0]])
        high = main.Page("high", 2, [], patches=[[20.0]])
        middle = main.Page("middle", 3, [], patches=[[30.0]])
        index = main.Index([low, high, middle])
        scores = {id(low.patches): -1.0, id(high.patches): 8.0, id(middle.patches): 2.5}

        with mock.patch.object(main, "tokenize", return_value=["q1", "q2"]) as tokenize:
            with mock.patch.object(main, "hash_embed", side_effect=lambda token: {"q1": [1.0], "q2": [2.0]}[token]) as embed:
                with mock.patch.object(main, "max_sim_score", side_effect=lambda query, patches: scores[id(patches)]) as score:
                    hits = index.retrieve("arbitrary query", k=2)

        self.assertEqual([(page.doc_id, value) for page, value in hits], [("high", 8.0), ("middle", 2.5)])
        tokenize.assert_called_once_with("arbitrary query")
        self.assertEqual(embed.call_args_list, [mock.call("q1"), mock.call("q2")])
        self.assertEqual(score.call_count, 3)
        for call in score.call_args_list:
            self.assertEqual(call.args[0], [[1.0], [2.0]])


class TestMain(unittest.TestCase):
    def test_runs_queries_and_pruning_ablation_with_observable_report(self):
        page_a = SimpleNamespace(doc_id="doc-a", page_num=1)
        page_b = SimpleNamespace(doc_id="doc-b", page_num=2)
        page_c = SimpleNamespace(doc_id="doc-c", page_num=3)

        class FakeIndex:
            def __init__(self, pages, hits):
                self.pages = pages
                self.hits = hits
                self.calls = []

            def retrieve(self, query, k=5):
                self.calls.append((query, k))
                return self.hits[:k]

        initial = FakeIndex([page_a, page_b], [(page_a, 1.25), (page_b, 0.5)])
        full = FakeIndex([page_a, page_b, page_c], [(page_a, 3.0), (page_b, 2.0), (page_c, 1.0)])
        pruned = FakeIndex([page_a, page_b, page_c], [(page_b, 2.5), (page_c, 1.5), (page_a, 0.5)])
        output = io.StringIO()

        with mock.patch.object(main, "build_index", side_effect=[initial, full, pruned]) as build:
            with redirect_stdout(output):
                result = main.main()

        self.assertIsNone(result)
        self.assertEqual(build.call_args_list, [mock.call(prune=True), mock.call(prune=False), mock.call(prune=True)])
        self.assertEqual(len(initial.calls), 4)
        self.assertTrue(all(k == 3 for _, k in initial.calls))
        self.assertEqual(full.calls, [("chart comparing segment margins", 3)])
        self.assertEqual(pruned.calls, [("chart comparing segment margins", 3)])
        report = output.getvalue()
        self.assertIn("pages indexed: 2", report)
        self.assertIn("Q: what was the 2024 operating margin change for EMEA", report)
        self.assertIn("doc-a p.1", report)
        self.assertIn("ablation: pruning off vs on", report)
        self.assertIn("overlap", report)
        self.assertIn("3/3", report)


if __name__ == "__main__":
    unittest.main()
