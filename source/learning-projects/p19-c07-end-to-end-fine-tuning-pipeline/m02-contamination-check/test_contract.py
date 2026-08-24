import contextlib
import io
import unittest
from unittest.mock import patch

import main


class TestStageData(unittest.TestCase):
    def test_applies_filters_and_records_seed(self):
        artifact = main.stage_data(main.Manifest(), {"raw_examples": 1001, "seed": 42})

        self.assertEqual(artifact.name, "dataset")
        self.assertEqual(artifact.kind, "dataset")
        self.assertEqual(artifact.produced_by, "Datatrove+Nemotron-CC+Presidio")
        self.assertEqual(artifact.payload, {
            "raw_examples": 1001,
            "after_dedup": int(1001 * 0.94),
            "after_quality": int(1001 * 0.94 * 0.91),
            "after_pii_scrub": int(1001 * 0.94 * 0.91 * 0.995),
            "seed": 42,
        })
        self.assertGreaterEqual(artifact.payload["raw_examples"], artifact.payload["after_dedup"])
        self.assertGreaterEqual(artifact.payload["after_dedup"], artifact.payload["after_quality"])
        self.assertGreaterEqual(artifact.payload["after_quality"], artifact.payload["after_pii_scrub"])


class TestStageContamination(unittest.TestCase):
    def test_reports_all_benchmarks_for_exact_dataset_hash(self):
        dataset = main.Artifact("dataset", "dataset", {"rows": 17, "seed": 3}, "fixture")
        manifest = main.Manifest({"dataset": dataset})

        report = main.stage_contamination(manifest, {})

        self.assertEqual(report.name, "contamination_check")
        self.assertEqual(report.kind, "report")
        self.assertEqual(report.produced_by, "minhash-lsh")
        self.assertEqual(report.payload["dataset_hash"], dataset.content_hash())
        self.assertEqual(report.payload["status"], "clean")
        overlaps = report.payload["overlaps"]
        self.assertEqual([item["bench"] for item in overlaps], [
            "MMLU-Pro", "MT-Bench-v2", "RewardBench-2"
        ])
        self.assertTrue(all(item["overlap_examples"] == 0 for item in overlaps))


class TestStageSft(unittest.TestCase):
    def test_checkpoint_is_bound_to_base_and_dataset(self):
        dataset = main.Artifact("dataset", "dataset", {"examples": [1, 2, 3]}, "fixture")
        manifest = main.Manifest({"dataset": dataset})

        checkpoint = main.stage_sft(manifest, {"base_model": "qwen3-14b"})

        self.assertEqual(checkpoint.name, "sft_checkpoint")
        self.assertEqual(checkpoint.kind, "checkpoint")
        self.assertEqual(checkpoint.produced_by, "axolotl v0.8 + ZeRO-3")
        self.assertEqual(checkpoint.payload["base"], "qwen3-14b")
        self.assertEqual(checkpoint.payload["dataset_hash"], dataset.content_hash())
        self.assertEqual(checkpoint.payload["epochs"], 3)
        self.assertEqual(checkpoint.payload["gpus"], 8)
        self.assertGreater(checkpoint.payload["hours"], 0)
        self.assertGreater(checkpoint.payload["val_loss"], 0)


class TestStageDpo(unittest.TestCase):
    def test_checkpoint_references_sft_content_hash(self):
        sft = main.Artifact("sft_checkpoint", "checkpoint", {"weights": "abc"}, "fixture")
        manifest = main.Manifest({"sft_checkpoint": sft})

        checkpoint = main.stage_dpo(manifest, {"dpo_beta": 0.5})

        self.assertEqual(checkpoint.name, "dpo_checkpoint")
        self.assertEqual(checkpoint.kind, "checkpoint")
        self.assertEqual(checkpoint.produced_by, "trl 0.15 DPO")
        self.assertEqual(checkpoint.payload["from"], sft.content_hash())
        self.assertEqual(checkpoint.payload["epochs"], 1)
        self.assertEqual(checkpoint.payload["beta"], 0.08)
        self.assertGreater(checkpoint.payload["hours"], 0)


class TestStageQuantize(unittest.TestCase):
    def test_emits_three_positive_quant_sizes_from_dpo(self):
        dpo = main.Artifact("dpo_checkpoint", "checkpoint", {"step": 99}, "fixture")
        manifest = main.Manifest({"dpo_checkpoint": dpo})

        quants = main.stage_quantize(manifest, {})

        self.assertEqual(quants.name, "quants")
        self.assertEqual(quants.kind, "quant")
        self.assertEqual(quants.produced_by, "gptq+awq+llama.cpp")
        self.assertEqual(quants.payload["from"], dpo.content_hash())
        self.assertEqual(set(quants.payload), {
            "from", "gptq_int4_gb", "awq_int4_gb", "gguf_q4_km_gb"
        })
        for key in ("gptq_int4_gb", "awq_int4_gb", "gguf_q4_km_gb"):
            self.assertGreater(quants.payload[key], 0)


class TestStageServe(unittest.TestCase):
    def test_describes_speculative_quantized_endpoint_metrics(self):
        quant = main.Artifact("quants", "quant", {"gptq": "hash"}, "fixture")
        manifest = main.Manifest({"quants": quant})

        endpoint = main.stage_serve(manifest, {})

        self.assertEqual(endpoint.name, "endpoint")
        self.assertEqual(endpoint.kind, "endpoint")
        self.assertEqual(endpoint.produced_by, "vllm+speculators")
        self.assertEqual(endpoint.payload["backend"], "vLLM 0.7 + EAGLE-3")
        self.assertEqual(endpoint.payload["quant"], "GPTQ-INT4-Marlin")
        self.assertGreaterEqual(endpoint.payload["eagle_acceptance"], 0)
        self.assertLessEqual(endpoint.payload["eagle_acceptance"], 1)
        self.assertGreater(endpoint.payload["p99_bs8_ms"], 0)
        self.assertGreater(endpoint.payload["tokens_per_sec_bs32"], 0)
        self.assertGreater(endpoint.payload["dollars_per_mtokens"], 0)


class TestStageEval(unittest.TestCase):
    def test_report_is_bound_to_checkpoint_and_has_eval_deltas(self):
        dpo = main.Artifact("dpo_checkpoint", "checkpoint", {"weights": "v2"}, "fixture")
        manifest = main.Manifest({"dpo_checkpoint": dpo})

        report = main.stage_eval(manifest, {})

        self.assertEqual(report.name, "eval_report")
        self.assertEqual(report.kind, "report")
        self.assertEqual(report.produced_by, "lm-eval-harness")
        self.assertEqual(report.payload["from"], dpo.content_hash())
        for key in ("mmlu_pro_delta", "mt_bench_v2_delta", "rewardbench2_delta"):
            self.assertIsInstance(report.payload[key], float)
            self.assertGreater(report.payload[key], 0)
        self.assertGreaterEqual(report.payload["llama_guard_4_pass"], 0)
        self.assertLessEqual(report.payload["llama_guard_4_pass"], 1)


class TestStageModelCard(unittest.TestCase):
    def test_card_links_training_eval_safety_and_reproduction(self):
        sft = main.Artifact("sft_checkpoint", "checkpoint", {"run": "stable"}, "fixture")
        manifest = main.Manifest({"sft_checkpoint": sft})

        card = main.stage_model_card(manifest, {})

        self.assertEqual(card.name, "model_card")
        self.assertEqual(card.kind, "report")
        self.assertEqual(card.produced_by, "mof-template")
        self.assertEqual(card.payload["standard"], "MOF 2026")
        self.assertEqual(card.payload["training_config_hash"], sft.content_hash())
        self.assertIs(card.payload["data_license_declared"], True)
        self.assertIs(card.payload["eval_attached"], True)
        self.assertIs(card.payload["safety_attached"], True)
        self.assertEqual(
            card.payload["reproducibility_command"],
            "./pipeline.sh config/llama3.3-8b-domainX.yaml",
        )


class TestRunPipeline(unittest.TestCase):
    def test_runs_declared_order_and_adds_each_artifact_before_next_stage(self):
        calls = []

        def first(manifest, cfg):
            calls.append(("first", list(manifest.artifacts), cfg["token"]))
            return main.Artifact("alpha", "report", {"n": 1}, "first")

        def second(manifest, cfg):
            calls.append(("second", list(manifest.artifacts), cfg["token"]))
            self.assertEqual(manifest.get("alpha").payload, {"n": 1})
            return main.Artifact("omega", "report", {"n": 2}, "second")

        fake_pipeline = [("first-stage", first), ("second-stage", second)]
        with patch.object(main, "PIPELINE", fake_pipeline):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                manifest = main.run_pipeline({"token": "cfg-value"})

        self.assertEqual(calls, [
            ("first", [], "cfg-value"),
            ("second", ["alpha"], "cfg-value"),
        ])
        self.assertEqual(list(manifest.artifacts), ["alpha", "omega"])
        self.assertIs(manifest.get("alpha").produced_by, "first")
        self.assertIs(manifest.get("omega").produced_by, "second")
        rendered = output.getvalue()
        self.assertIn("[first-stage", rendered)
        self.assertIn("artifact 'alpha'", rendered)
        self.assertIn("[second-stage", rendered)
        self.assertIn("artifact 'omega'", rendered)


if __name__ == "__main__":
    unittest.main()
