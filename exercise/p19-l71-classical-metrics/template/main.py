"""Classical metrics: exact_match, F1, BLEU-4, ROUGE-L, accuracy.

Conceptual references:
- ./docs/en.md (this lesson)
- lesson 70 (task spec format) for the metric_name field

Stdlib + numpy. Run: python3 code/main.py
"""

from __future__ import annotations

import math
import re
import sys
from collections import Counter

import numpy as np


TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """Реализуй единый контракт токенизации: приведи текст к нижнему регистру и извлеки совпадения TOKEN_RE."""
    raise NotImplementedError


def exact_match(prediction: str, targets: list[str]) -> float:
    if not targets:
        return 0.0
    pred = prediction.strip()
    return 1.0 if any(pred == t.strip() for t in targets) else 0.0


def accuracy(prediction: str, targets: list[str]) -> float:
    return exact_match(prediction, targets)


def f1_score(prediction: str, target: str) -> float:
    """Вычисли токенный F1 через мультимножественное пересечение токенов, корректно обработав пустые строки и отсутствие пересечений."""
    raise NotImplementedError


def _ngram_counts(tokens: list[str], n: int) -> Counter:
    if n <= 0:
        raise ValueError("n must be positive")
    if len(tokens) < n:
        return Counter()
    return Counter(tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1))


def _modified_precision(cand_tokens: list[str], ref_tokens: list[str], n: int) -> tuple[int, int]:
    cand_ngrams = _ngram_counts(cand_tokens, n)
    if not cand_ngrams:
        return (0, 0)
    ref_ngrams = _ngram_counts(ref_tokens, n)
    clipped = 0
    for gram, count in cand_ngrams.items():
        clipped += min(count, ref_ngrams.get(gram, 0))
    total = sum(cand_ngrams.values())
    return (clipped, total)


def _brevity_penalty(cand_len: int, ref_len: int) -> float:
    if cand_len == 0:
        return 0.0
    if cand_len >= ref_len:
        return 1.0
    return math.exp(1.0 - ref_len / cand_len)


def bleu4(prediction: str, reference: str, max_n: int = 4) -> float:
    """Реализуй BLEU-4 из модифицированных n-граммных точностей со сглаживанием add-one, геометрическим средним и штрафом за краткость."""
    raise NotImplementedError


def lcs_length(a: list[str], b: list[str]) -> int:
    """Найди длину наибольшей общей подпоследовательности двух списков токенов с помощью динамического программирования."""
    raise NotImplementedError


def rouge_l(prediction: str, reference: str, beta: float = 1.0) -> float:
    cand = tokenize(prediction)
    ref = tokenize(reference)
    if not cand and not ref:
        return 1.0
    if not cand or not ref:
        return 0.0
    lcs = lcs_length(cand, ref)
    if lcs == 0:
        return 0.0
    precision = lcs / len(cand)
    recall = lcs / len(ref)
    if precision == 0.0 and recall == 0.0:
        return 0.0
    beta_sq = beta * beta
    denom = recall + beta_sq * precision
    if denom == 0:
        return 0.0
    return float((1 + beta_sq) * precision * recall / denom)


METRIC_TABLE = {
    "exact_match": "scalar",
    "accuracy": "scalar",
    "f1": "per_target_max",
    "bleu_4": "per_target_max",
    "rouge_l": "per_target_max",
}


def score(metric_name: str, prediction: str, targets: list[str]) -> float:
    """Реализуй диспетчер метрик: выбери функцию по metric_name, для метрик сравнения с эталоном возьми максимум по targets и отклони неизвестное имя."""
    raise NotImplementedError


def corpus_mean(scores: list[float]) -> float:
    if not scores:
        return 0.0
    return float(np.mean(scores))


def corpus_bleu(predictions: list[str], references: list[str], max_n: int = 4) -> float:
    if len(predictions) != len(references):
        raise ValueError("predictions and references must align")
    if not predictions:
        return 0.0
    total_cand_len = 0
    total_ref_len = 0
    clipped_sums = [0] * max_n
    total_sums = [0] * max_n
    for cand_text, ref_text in zip(predictions, references):
        cand = tokenize(cand_text)
        ref = tokenize(ref_text)
        total_cand_len += len(cand)
        total_ref_len += len(ref)
        for n in range(1, max_n + 1):
            clipped, total = _modified_precision(cand, ref, n)
            clipped_sums[n - 1] += clipped
            total_sums[n - 1] += total
    if total_cand_len == 0:
        return 0.0
    log_p_sum = 0.0
    for n in range(1, max_n + 1):
        num = clipped_sums[n - 1] + 1
        den = total_sums[n - 1] + 1
        log_p_sum += math.log(num / den)
    geo = math.exp(log_p_sum / max_n)
    bp = _brevity_penalty(total_cand_len, total_ref_len)
    return float(bp * geo)


def _reference_examples() -> list[dict]:
    return [
        {"metric": "exact_match", "pred": "41", "targets": ["41"], "expected": 1.0},
        {"metric": "exact_match", "pred": "42", "targets": ["41"], "expected": 0.0},
        {"metric": "f1", "pred": "the cat sat", "targets": ["a cat sat on the mat"], "expected_approx": 0.667},
        {"metric": "f1", "pred": "", "targets": ["the cat"], "expected": 0.0},
        {"metric": "bleu_4", "pred": "the cat sat on the mat",
         "targets": ["the cat sat on the mat"], "expected_approx": 1.0},
        {"metric": "bleu_4", "pred": "the the the the",
         "targets": ["the cat sat on the mat"], "expected_lt": 0.5},
        {"metric": "rouge_l", "pred": "the cat sat",
         "targets": ["the cat sat on the mat"], "expected_approx": 0.667},
        {"metric": "accuracy", "pred": "positive", "targets": ["positive"], "expected": 1.0},
    ]


def demo() -> int:
    print("metric demos (using example vectors):")
    failures = 0
    for ex in _reference_examples():
        actual = score(ex["metric"], ex["pred"], ex["targets"])
        if "expected" in ex:
            ok = abs(actual - ex["expected"]) < 1e-9
            print(f"  {ex['metric']:10s} pred={ex['pred']!r:30s} -> {actual:.4f} expected={ex['expected']}")
            if not ok:
                failures += 1
        elif "expected_approx" in ex:
            ok = abs(actual - ex["expected_approx"]) < 0.05
            print(f"  {ex['metric']:10s} pred={ex['pred']!r:30s} -> {actual:.4f} approx={ex['expected_approx']}")
            if not ok:
                failures += 1
        elif "expected_lt" in ex:
            ok = actual < ex["expected_lt"]
            print(f"  {ex['metric']:10s} pred={ex['pred']!r:30s} -> {actual:.4f} < {ex['expected_lt']}")
            if not ok:
                failures += 1
    preds = ["the cat sat on the mat", "the runner won the race"]
    refs = ["the cat sat on the mat", "the runner crossed the finish line first"]
    corpus = corpus_bleu(preds, refs)
    print(f"  corpus_bleu over 2 examples -> {corpus:.4f}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(demo())
