import math
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import main


class StubChunk:
    def __init__(self, anchor, symbol="", summary=""):
        self._anchor = anchor
        self.symbol = symbol
        self.summary = summary

    def anchor(self):
        return self._anchor


class TestChunkAnchor(unittest.TestCase):
    def test_formats_repo_path_and_line_range(self):
        chunk = main.Chunk(
            repo="payments",
            path="src/services/charge.py",
            start_line=17,
            end_line=43,
            symbol="charge",
            body="def charge(): pass",
        )
        self.assertEqual(
            chunk.anchor(),
            "payments/src/services/charge.py:17-43",
        )


class TestFakeEmbed(unittest.TestCase):
    def test_is_deterministic_normalized_and_handles_empty_text(self):
        vector = main.fake_embed("Alpha alpha beta", dim=32)

        self.assertEqual(len(vector), 32)
        self.assertTrue(all(isinstance(value, float) for value in vector))
        self.assertAlmostEqual(
            math.sqrt(sum(value * value for value in vector)),
            1.0,
            places=12,
        )
        self.assertEqual(vector, main.fake_embed("Alpha alpha beta", dim=32))
        self.assertEqual(main.fake_embed("", dim=7), [0.0] * 7)


class TestDenseIndexAdd(unittest.TestCase):
    def test_embeds_all_fields_and_stores_chunk_with_vector(self):
        chunk = SimpleNamespace(
            symbol="CreateOrder",
            summary="creates an order",
            body="return repository.insert(order)",
        )
        embedding = [0.25, 0.75]
        index = main.DenseIndex()

        with patch("main.fake_embed", return_value=embedding) as embed:
            index.add(chunk)

        embed.assert_called_once_with(
            "CreateOrder\ncreates an order\nreturn repository.insert(order)"
        )
        self.assertEqual(len(index.vectors), 1)
        self.assertIs(index.vectors[0][0], chunk)
        self.assertIs(index.vectors[0][1], embedding)


class TestTokenize(unittest.TestCase):
    def test_lowercases_and_extracts_unicode_word_tokens(self):
        self.assertEqual(
            main.tokenize("HTTP2, Foo_bar! naïve/Café -- 42"),
            ["http2", "foo_bar", "naïve", "café", "42"],
        )
        self.assertEqual(main.tokenize("... ---"), [])


class TestBM25IndexAdd(unittest.TestCase):
    def test_applies_field_weights_and_updates_corpus_statistics(self):
        first = SimpleNamespace(symbol="S1", summary="M1", body="B1")
        second = SimpleNamespace(symbol="S2", summary="M2", body="B2")
        token_map = {
            "S1": ["shared", "sym"],
            "M1": ["shared", "sum"],
            "B1": ["body"],
            "S2": ["other"],
            "M2": ["shared"],
            "B2": ["body", "body"],
        }
        index = main.BM25Index()

        with patch("main.tokenize", side_effect=lambda text: list(token_map[text])) as tokenize:
            index.add(first)
            index.add(second)

        self.assertEqual(
            tokenize.call_args_list,
            [call("S1"), call("M1"), call("B1"), call("S2"), call("M2"), call("B2")],
        )
        self.assertEqual(index.docs, [first, second])
        self.assertEqual(index.doc_lens, [13, 8])
        self.assertEqual(
            index.tf[0],
            Counter({"shared": 6, "sym": 4, "sum": 2, "body": 1}),
        )
        self.assertEqual(
            index.tf[1],
            Counter({"other": 4, "shared": 2, "body": 2}),
        )
        self.assertEqual(
            index.df,
            Counter({"shared": 2, "body": 2, "sym": 1, "sum": 1, "other": 1}),
        )
        self.assertEqual(index.avgdl, 10.5)


class TestRRF(unittest.TestCase):
    def test_deduplicates_anchors_and_sums_reciprocal_ranks(self):
        a = StubChunk("repo/a.py:1-2")
        b = StubChunk("repo/b.py:3-4")
        c = StubChunk("repo/c.py:5-6")

        fused = main.rrf(
            dense=[(a, 100.0), (b, 1.0)],
            sparse=[(b, 0.01), (c, 999.0)],
            k_rrf=60,
        )

        self.assertEqual([chunk.anchor() for chunk, _ in fused], [b.anchor(), a.anchor(), c.anchor()])
        self.assertEqual(len(fused), 3)
        self.assertAlmostEqual(fused[0][1], 1.0 / 62 + 1.0 / 61)
        self.assertAlmostEqual(fused[1][1], 1.0 / 61)
        self.assertAlmostEqual(fused[2][1], 1.0 / 62)
        self.assertEqual(main.rrf([], []), [])


class TestRerank(unittest.TestCase):
    def test_boosts_symbol_and_summary_overlap_then_limits_top_k(self):
        symbol_hit = StubChunk("symbol", symbol="needle handler", summary="unrelated")
        summary_hit = StubChunk("summary", symbol="other", summary="uses needle safely")
        prior_hit = StubChunk("prior", symbol="other", summary="unrelated")
        candidates = [(symbol_hit, 0.0), (summary_hit, 0.75), (prior_hit, 0.8)]
        original = list(candidates)

        with patch("main.tokenize", side_effect=lambda text: text.lower().split()):
            ranked = main.rerank("needle", candidates, top_k=2)

        self.assertEqual(candidates, original)
        self.assertEqual([chunk for chunk, _ in ranked], [symbol_hit, summary_hit])
        self.assertAlmostEqual(ranked[0][1], 0.9)
        self.assertAlmostEqual(ranked[1][1], 0.85)


class TestAnswer(unittest.TestCase):
    def test_runs_pipeline_and_returns_only_anchor_based_views(self):
        dense_chunks = [StubChunk(f"dense/{i}:1-2") for i in range(4)]
        sparse_chunks = [StubChunk(f"sparse/{i}:3-4") for i in range(4)]
        fused_chunks = [StubChunk(f"fused/{i}:5-6") for i in range(6)]
        final_chunks = [StubChunk("final/a.py:7-8"), StubChunk("final/b.py:9-10")]
        dense_hits = [(chunk, 1.0 - i / 10) for i, chunk in enumerate(dense_chunks)]
        sparse_hits = [(chunk, 2.0 - i / 10) for i, chunk in enumerate(sparse_chunks)]
        fused_hits = [(chunk, 3.0 - i / 10) for i, chunk in enumerate(fused_chunks)]
        final_hits = [(final_chunks[0], 5.0), (final_chunks[1], 4.0)]
        dense = Mock()
        bm25 = Mock()
        dense.search.return_value = dense_hits
        bm25.search.return_value = sparse_hits

        with patch("main.rrf", return_value=fused_hits) as fuse, patch(
            "main.rerank", return_value=final_hits
        ) as rerank:
            result = main.answer("where is the implementation", dense, bm25)

        dense.search.assert_called_once_with("where is the implementation", k=10)
        bm25.search.assert_called_once_with("where is the implementation", k=10)
        fuse.assert_called_once_with(dense_hits, sparse_hits)
        rerank.assert_called_once_with("where is the implementation", fused_hits, top_k=5)
        self.assertEqual(
            result,
            {
                "query": "where is the implementation",
                "dense_top": [chunk.anchor() for chunk in dense_chunks[:3]],
                "sparse_top": [chunk.anchor() for chunk in sparse_chunks[:3]],
                "fused_top": [chunk.anchor() for chunk in fused_chunks[:5]],
                "rerank_top": [chunk.anchor() for chunk in final_chunks],
            },
        )


if __name__ == "__main__":
    unittest.main()
