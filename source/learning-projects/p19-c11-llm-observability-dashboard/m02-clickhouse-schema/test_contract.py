import hashlib
import math
import random
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import main


class TestTailSamplerDecide(unittest.TestCase):
    def test_error_and_eval_retention_precede_sampling(self):
        rng = Mock()
        rng.random.return_value = 0.99
        sampler = main.TailSampler(sample_rate=0.0, rng=rng)

        error_span = SimpleNamespace(status="error", name="operation", attributes={})
        self.assertTrue(sampler.decide([error_span]))
        rng.random.assert_not_called()

        toxic_eval = SimpleNamespace(
            status="ok", name="eval", attributes={"toxicity": 0.51}
        )
        self.assertTrue(sampler.decide([toxic_eval]))
        rng.random.assert_not_called()

        pii_eval = SimpleNamespace(
            status="ok", name="eval", attributes={"pii_leak": 0.81}
        )
        self.assertTrue(sampler.decide([pii_eval]))
        rng.random.assert_not_called()

    def test_success_sampling_uses_strict_rate(self):
        rng = Mock()
        rng.random.side_effect = [0.099, 0.1]
        sampler = main.TailSampler(sample_rate=0.1, rng=rng)
        safe_span = SimpleNamespace(status="ok", name="operation", attributes={})

        self.assertTrue(sampler.decide([safe_span]))
        self.assertFalse(sampler.decide([safe_span]))
        self.assertEqual(rng.random.call_count, 2)


class TestSpanStoreInsertTrace(unittest.TestCase):
    def test_inserts_all_spans_and_aggregates_only_llm_spans(self):
        class StubSpan:
            def __init__(self, llm, attributes):
                self._llm = llm
                self.attributes = attributes

            def is_llm(self):
                return self._llm

        alice = StubSpan(True, {
            "user_id": "alice",
            "gen_ai.request.model": "model-a",
            "cost_usd": 0.25,
        })
        defaults = StubSpan(True, {})
        metadata = StubSpan(False, {
            "user_id": "ignored",
            "gen_ai.request.model": "ignored-model",
            "cost_usd": 100.0,
        })
        trace = [metadata, alice, defaults]
        store = main.SpanStore()

        result = store.insert_trace(trace)

        self.assertIsNone(result)
        self.assertEqual(store.spans, trace)
        self.assertEqual(dict(store.by_user), {"alice": 1, "anon": 1})
        self.assertEqual(dict(store.by_model), {"model-a": 1, "unknown": 1})
        self.assertEqual(dict(store.cost_by_user), {"alice": 0.25, "anon": 0.0})


class TestSpanIsLlm(unittest.TestCase):
    def test_detects_exact_semantic_convention_key_by_presence(self):
        def span(attributes):
            return main.Span(
                trace_id="t",
                span_id="s",
                parent_span_id=None,
                name="call",
                start_ms=0,
                duration_ms=1,
                attributes=attributes,
            )

        self.assertTrue(span({"gen_ai.system": "openai"}).is_llm())
        self.assertTrue(span({"gen_ai.system": None}).is_llm())
        self.assertFalse(span({}).is_llm())
        self.assertFalse(span({"gen_ai.request.model": "gpt"}).is_llm())
        self.assertFalse(span({"gen_ai.system.extra": "openai"}).is_llm())


class TestEnrichWithEvals(unittest.TestCase):
    def test_adds_one_linked_eval_child_per_llm_without_mutating_input(self):
        llm = SimpleNamespace(
            trace_id="trace-1",
            span_id="llm-1",
            parent_span_id="root-1",
            name="llm",
            start_ms=1000,
            duration_ms=250,
            attributes={"response": "answer", "context": "context"},
            is_llm=lambda: True,
        )
        ordinary = SimpleNamespace(
            trace_id="trace-1",
            span_id="root-1",
            parent_span_id=None,
            name="root",
            start_ms=900,
            duration_ms=500,
            attributes={},
            is_llm=lambda: False,
        )
        trace = [ordinary, llm]

        with patch.object(main, "eval_faithfulness", return_value=0.11) as faith:
            with patch.object(main, "eval_toxicity", return_value=0.22) as toxicity:
                with patch.object(main, "eval_pii_leak", return_value=0.33) as pii:
                    enriched = main.enrich_with_evals(trace)

        self.assertEqual(len(trace), 2)
        self.assertEqual(len(enriched), 3)
        self.assertIs(enriched[0], ordinary)
        self.assertIs(enriched[1], llm)

        child = enriched[2]
        self.assertIsInstance(child, main.Span)
        self.assertEqual(child.trace_id, "trace-1")
        self.assertEqual(child.span_id, "llm-1_eval")
        self.assertEqual(child.parent_span_id, "llm-1")
        self.assertEqual(child.name, "eval")
        self.assertEqual(child.start_ms, 1250)
        self.assertEqual(child.duration_ms, 120)
        self.assertEqual(child.attributes, {
            "faithfulness": 0.11,
            "toxicity": 0.22,
            "pii_leak": 0.33,
        })
        faith.assert_called_once_with("answer", "context")
        toxicity.assert_called_once_with("answer")
        pii.assert_called_once_with("answer")


class TestEvalPiiLeak(unittest.TestCase):
    def test_scores_ssn_and_prioritizes_it_over_other_pii(self):
        self.assertEqual(main.eval_pii_leak("SSN: 123-45-6789"), 0.95)
        self.assertEqual(
            main.eval_pii_leak("Email a@example.com, SSN 987-65-4321"),
            0.95,
        )

    def test_scores_email_and_safe_or_malformed_values(self):
        self.assertEqual(main.eval_pii_leak("Contact a+b@example.co.uk"), 0.6)
        self.assertEqual(main.eval_pii_leak("No personal data here"), 0.05)
        self.assertEqual(main.eval_pii_leak("Malformed 123-45-67890"), 0.05)


class TestPromptFingerprint(unittest.TestCase):
    def test_is_deterministic_utf8_sha256_bucket(self):
        for prompt, bins in [("hello", 8), ("Tokyo weather", 13), ("привет", 7)]:
            expected = hashlib.sha256(prompt.encode()).digest()[0] % bins
            first = main.prompt_fingerprint(prompt, n_bins=bins)
            second = main.prompt_fingerprint(prompt, n_bins=bins)
            self.assertEqual(first, expected)
            self.assertEqual(second, expected)
            self.assertGreaterEqual(first, 0)
            self.assertLess(first, bins)

        self.assertEqual(main.prompt_fingerprint("anything", n_bins=1), 0)


class TestPsi(unittest.TestCase):
    def test_computes_smoothed_symmetric_population_stability_index(self):
        a = [0, 0, 1, 1]
        b = [0, 1, 2, 2]
        expected = (
            (0.5 - 0.25) * math.log(0.5 / 0.25)
            + (0.5 - 0.25) * math.log(0.5 / 0.25)
            + (0.0001 - 0.5) * math.log(0.0001 / 0.5)
        )

        score = main.psi(a, b, n_bins=3)
        self.assertAlmostEqual(score, expected, places=12)
        self.assertAlmostEqual(score, main.psi(b, a, n_bins=3), places=12)
        self.assertGreater(score, 0.2)
        self.assertAlmostEqual(main.psi(a, a, n_bins=3), 0.0, places=12)
        self.assertAlmostEqual(main.psi([], [], n_bins=3), 0.0, places=12)


class TestAlerter(unittest.TestCase):
    def test_emits_ordered_threshold_alerts_with_first_trace_reference(self):
        spans = [
            SimpleNamespace(
                name="eval", trace_id="at-threshold",
                attributes={"pii_leak": 0.8, "toxicity": 0.5},
            ),
            SimpleNamespace(
                name="eval", trace_id="pii-first",
                attributes={"pii_leak": 0.95},
            ),
            SimpleNamespace(
                name="eval", trace_id="toxic",
                attributes={"toxicity": 0.75},
            ),
            SimpleNamespace(
                name="eval", trace_id="pii-second",
                attributes={"pii_leak": 0.81},
            ),
            SimpleNamespace(
                name="llm_call", trace_id="not-an-eval",
                attributes={"pii_leak": 1.0, "toxicity": 1.0},
            ),
        ]

        self.assertEqual(main.alerter(SimpleNamespace(spans=spans)), [
            "PII LEAK DETECTED: 2 events (first trace: pii-first)",
            "TOXICITY SURGE: 1 events",
        ])
        self.assertEqual(main.alerter(SimpleNamespace(spans=[])), [])


class TestSynthTrace(unittest.TestCase):
    def test_builds_linked_deterministic_trace_and_controls_regression_response(self):
        with patch.object(main.time, "time", return_value=1234.567):
            safe = main.synth_trace("trace-x", False, random.Random(41))
            leaked = main.synth_trace("trace-x", True, random.Random(41))

        self.assertEqual(len(safe), 2)
        root, llm = safe
        self.assertIsInstance(root, main.Span)
        self.assertIsInstance(llm, main.Span)
        self.assertEqual(root.trace_id, "trace-x")
        self.assertEqual(root.span_id, "trace-x_0")
        self.assertIsNone(root.parent_span_id)
        self.assertEqual(root.name, "chat_turn")
        self.assertEqual(root.start_ms, 1234567)
        self.assertEqual(root.attributes, {"app_id": "chatbot"})
        self.assertGreaterEqual(root.duration_ms, 400)
        self.assertLessEqual(root.duration_ms, 2400)

        self.assertEqual(llm.trace_id, root.trace_id)
        self.assertEqual(llm.span_id, "trace-x_1")
        self.assertEqual(llm.parent_span_id, root.span_id)
        self.assertEqual(llm.name, "llm_call")
        self.assertEqual(llm.start_ms, root.start_ms + 50)
        self.assertEqual(llm.duration_ms, root.duration_ms - 80)
        self.assertIn(llm.attributes["gen_ai.request.model"], {
            "claude-sonnet-4-7", "gpt-5-4", "gemini-3-pro"
        })
        self.assertEqual(
            llm.attributes["gen_ai.system"],
            llm.attributes["gen_ai.request.model"].split("-")[0],
        )
        self.assertIn(llm.attributes["user_id"], {"u_01", "u_02", "u_03", "u_04"})
        self.assertGreaterEqual(llm.attributes["gen_ai.usage.input_tokens"], 80)
        self.assertLessEqual(llm.attributes["gen_ai.usage.input_tokens"], 800)
        self.assertGreaterEqual(llm.attributes["gen_ai.usage.output_tokens"], 20)
        self.assertLessEqual(llm.attributes["gen_ai.usage.output_tokens"], 300)
        self.assertGreaterEqual(llm.attributes["cost_usd"], 0.002)
        self.assertLessEqual(llm.attributes["cost_usd"], 0.05)
        self.assertEqual(llm.attributes["response"], "the weather in Tokyo is mild")
        self.assertEqual(leaked[1].attributes["response"], "your ssn is 123-45-6789")

        safe_without_response = dict(llm.attributes)
        leaked_without_response = dict(leaked[1].attributes)
        safe_without_response.pop("response")
        leaked_without_response.pop("response")
        self.assertEqual(safe_without_response, leaked_without_response)


if __name__ == "__main__":
    unittest.main()
