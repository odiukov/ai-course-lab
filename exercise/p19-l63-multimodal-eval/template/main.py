"""Multimodal evaluation: retrieval, VQA, and captioning.

Three metric surfaces:
  - Recall@K from a cosine similarity matrix between image and caption vectors
  - VQA exact match between predicted and reference answer ids
  - BLEU-4 with multi-reference smoothing

The demo evaluates an untrained model, trains it for 50 steps on a synthetic
mock corpus, and re-evaluates to show the metrics move above their random
baselines.

Run with: python3 main.py
"""

from __future__ import annotations

import importlib.util
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

THIS_DIR = Path(__file__).resolve().parent
PHASE_ROOT = THIS_DIR / "_resources"
if not PHASE_ROOT.is_dir():
    PHASE_ROOT = THIS_DIR.parent.parent
LESSON_62 = PHASE_ROOT / "62-vision-language-pretraining" / "code"


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_pretrain = _load_module("pretrain_lesson62", LESSON_62 / "main.py")
MultimodalModel = _pretrain.MultimodalModel
PretrainConfig = _pretrain.PretrainConfig
make_mock_corpus = _pretrain.make_mock_corpus
sample_batch = _pretrain.sample_batch
PAD_ID = _pretrain.PAD_ID


@dataclass
class RetrievalPair:
    image: torch.Tensor
    caption_ids: torch.Tensor


@dataclass
class VQATriple:
    image: torch.Tensor
    question_ids: torch.Tensor
    answer_id: int


@dataclass
class CaptionSample:
    image: torch.Tensor
    references: list[list[int]]


@dataclass
class EvalSuite:
    retrieval: list[RetrievalPair]
    vqa: list[VQATriple]
    caps: list[CaptionSample]


def recall_at_k(sim: torch.Tensor, k: int) -> tuple[float, float]:
    """Вычисли Recall@K для направлений image-to-text и text-to-image по квадратной матрице сходства, проверяя допустимость формы матрицы и значения k."""
    raise NotImplementedError


def vqa_exact_match(predictions: list[int], references: list[int]) -> float:
    """Рассчитай долю точных совпадений идентификаторов ответов, обработав пустой ввод и несовпадающие длины списков."""
    raise NotImplementedError


def _ngrams(seq: list[int], n: int) -> list[tuple[int, ...]]:
    if len(seq) < n:
        return []
    return [tuple(seq[i:i + n]) for i in range(len(seq) - n + 1)]


def _count(ngrams: list[tuple[int, ...]]) -> dict[tuple[int, ...], int]:
    out: dict[tuple[int, ...], int] = {}
    for g in ngrams:
        out[g] = out.get(g, 0) + 1
    return out


def bleu4(generated: list[int], references: list[list[int]],
          smoothing: bool = True) -> float:
    """Реализуй BLEU-4 для одной сгенерированной последовательности и нескольких эталонов: клиппированные n-граммы, сглаживание нулевых точностей и штраф за краткость."""
    raise NotImplementedError


def build_eval_suite(seed: int, n_samples: int, vocab_size: int, max_len: int
                     ) -> EvalSuite:
    """Собери детерминированный синтетический EvalSuite заданного размера с retrieval-парами, VQA-тройками и несколькими вариантами эталонных подписей."""
    raise NotImplementedError


def _stack_images(samples: list[torch.Tensor]) -> torch.Tensor:
    return torch.cat(samples, dim=0)


def evaluate(model: MultimodalModel, suite: EvalSuite) -> dict:
    model.eval()
    with torch.no_grad():
        images = _stack_images([p.image for p in suite.retrieval])
        captions = torch.cat([p.caption_ids for p in suite.retrieval], dim=0)

        memory, img_emb = model.encode_image(images)
        txt_emb = model.text_encoder(captions)
        img_n = F.normalize(img_emb, dim=-1)
        txt_n = F.normalize(txt_emb, dim=-1)
        sim = img_n @ txt_n.T

        r1_i, r1_t = recall_at_k(sim, 1)
        r5_i, r5_t = recall_at_k(sim, min(5, sim.shape[0]))
        r10_i, r10_t = recall_at_k(sim, min(10, sim.shape[0]))

        vqa_imgs = _stack_images([t.image for t in suite.vqa])
        vqa_q = torch.cat([t.question_ids for t in suite.vqa], dim=0)
        vqa_memory, _ = model.encode_image(vqa_imgs)
        vqa_logits = model.decoder(vqa_q, vqa_memory)
        last_non_pad = (vqa_q != PAD_ID).sum(dim=1).clamp(min=1) - 1
        batch_idx = torch.arange(vqa_logits.size(0), device=vqa_logits.device)
        last_step = vqa_logits[batch_idx, last_non_pad, :]
        preds = last_step.argmax(dim=-1).tolist()
        refs = [t.answer_id for t in suite.vqa]
        vqa_em = vqa_exact_match(preds, refs)

        cap_imgs = _stack_images([c.image for c in suite.caps])
        cap_memory, _ = model.encode_image(cap_imgs)
        cap_len = min(8, model.cfg.max_text_len - 1)
        prompts = torch.zeros(cap_memory.shape[0], 1, dtype=torch.long)
        generated_ids: list[list[int]] = [[] for _ in range(cap_memory.shape[0])]
        for step in range(cap_len):
            logits = model.decoder(prompts, cap_memory)
            next_tok = logits[:, -1, :].argmax(dim=-1)
            for b, t in enumerate(next_tok.tolist()):
                generated_ids[b].append(int(t))
            prompts = torch.cat([prompts, next_tok.unsqueeze(1)], dim=1)

        bleu_scores: list[float] = []
        for gen, ref_sample in zip(generated_ids, suite.caps):
            score = bleu4(gen, ref_sample.references, smoothing=True)
            bleu_scores.append(score)
        bleu_mean = sum(bleu_scores) / max(1, len(bleu_scores))

    return {
        "R@1_i2t": r1_i,
        "R@1_t2i": r1_t,
        "R@5_i2t": r5_i,
        "R@5_t2i": r5_t,
        "R@10_i2t": r10_i,
        "R@10_t2i": r10_t,
        "vqa_em": vqa_em,
        "bleu4": bleu_mean,
    }


def _print_metrics(label: str, metrics: dict) -> None:
    print(f"\n{label}")
    for k, v in metrics.items():
        print(f"  {k:12s} : {v:.4f}")


def main() -> None:
    print("=" * 60)
    print("MULTIMODAL EVALUATION")
    print("=" * 60)

    cfg = PretrainConfig(
        vision_hidden=64,
        projection_hidden=128,
        embed_dim=64,
        text_vocab=128,
        max_text_len=10,
        n_pairs=200,
        batch_size=16,
        steps=50,
        lr=5e-4,
        seed=0,
    )
    print(f"  text vocab : {cfg.text_vocab}")
    print(f"  embed dim  : {cfg.embed_dim}")
    print(f"  steps      : {cfg.steps}")

    torch.manual_seed(cfg.seed)
    model = MultimodalModel(cfg).train()

    print("\nbuilding eval suite (50 samples, held-out seed)...")
    suite = build_eval_suite(seed=cfg.seed + 7777, n_samples=50,
                             vocab_size=cfg.text_vocab, max_len=cfg.max_text_len)
    print(f"  retrieval pairs : {len(suite.retrieval)}")
    print(f"  vqa triples     : {len(suite.vqa)}")
    print(f"  caption samples : {len(suite.caps)}")

    before = evaluate(model, suite)
    _print_metrics("metrics BEFORE training (50-step random init):", before)

    print("\ntraining for 50 steps on the mock corpus...")
    model.train()
    opt = torch.optim.Adam(model.parameters(), lr=cfg.lr)
    corpus = make_mock_corpus(cfg.seed + 1, cfg.n_pairs, cfg.text_vocab, cfg.max_text_len)
    rng = np.random.default_rng(cfg.seed + 2)
    for step in range(cfg.steps):
        idx = rng.choice(len(corpus), size=cfg.batch_size, replace=False).tolist()
        imgs, ids = sample_batch(corpus, idx)
        contrast, lm, _ = model(imgs, ids)
        total = contrast + lm
        opt.zero_grad(set_to_none=True)
        total.backward()
        opt.step()
        if step % 10 == 0 or step == cfg.steps - 1:
            print(f"  step {step:3d}  total {total.item():.4f}")

    after = evaluate(model, suite)
    _print_metrics("metrics AFTER training:", after)

    print("\nmetric deltas (after - before):")
    for k in before:
        d = after[k] - before[k]
        marker = "+" if d >= 0 else "-"
        print(f"  {k:12s} : {after[k]:.4f}  ({marker}{abs(d):.4f})")

    print("\ndone.")


if __name__ == "__main__":
    main()
