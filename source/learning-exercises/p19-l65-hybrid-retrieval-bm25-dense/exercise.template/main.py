"""Hybrid retrieval: BM25 + dense + reciprocal rank fusion.

Pure-Python implementation. BM25 from the Robertson/Sparck Jones paper.
RRF from the 2009 Cormack/Clarke/Buettcher SIGIR paper.

References:
- ./docs/en.md
- Phase 19 lesson 64 (chunkers feeding this retriever)
- Phase 19 lesson 66 (reranker consuming the fused top-k)
- Phase 19 lesson 68 (eval harness over this retriever)

Run: python3 code/main.py
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class Doc:
    doc_id: str
    title: str
    body: str

    def field_text(self, field_name: str) -> str:
        return {"title": self.title, "body": self.body}.get(field_name, "")


# ---------------------------------------------------------------------------
# tokenizer
# ---------------------------------------------------------------------------

_TOKEN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


# ---------------------------------------------------------------------------
# BM25 from scratch
# ---------------------------------------------------------------------------

@dataclass
class BM25Index:
    k1: float = 1.5
    b: float = 0.75
    field_weights: dict[str, int] = field(default_factory=lambda: {"title": 3, "body": 1})
    docs: list[Doc] = field(default_factory=list)
    doc_lens: list[int] = field(default_factory=list)
    df: Counter = field(default_factory=Counter)
    tf: list[Counter] = field(default_factory=list)
    avgdl: float = 0.0

    def _doc_tokens(self, doc: Doc) -> list[str]:
        out: list[str] = []
        for field_name, weight in self.field_weights.items():
            tokens = tokenize(doc.field_text(field_name))
            out.extend(tokens * weight)
        return out

    def add(self, doc: Doc) -> None:
        tokens = self._doc_tokens(doc)
        counts = Counter(tokens)
        self.docs.append(doc)
        self.doc_lens.append(len(tokens))
        self.tf.append(counts)
        for term in counts:
            self.df[term] += 1
        self.avgdl = sum(self.doc_lens) / max(1, len(self.doc_lens))

    def search(self, query: str, k: int = 10) -> list[tuple[Doc, float]]:
        """Реализуй ранжирование документов по BM25 со сглаженным IDF, насыщением частоты термина, нормализацией длины и отсечением документов с нулевым баллом."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# deterministic mock embedding + dense retriever
# ---------------------------------------------------------------------------

def mock_embed(text: str, dim: int = 96) -> list[float]:
    """Построй детерминированный хеш-эмбеддинг токенов и символьных биграмм заданной размерности и нормализуй его до единичной длины."""
    raise NotImplementedError


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


@dataclass
class DenseIndex:
    vectors: list[tuple[Doc, list[float]]] = field(default_factory=list)

    def add(self, doc: Doc) -> None:
        text = f"{doc.title}\n{doc.body}"
        self.vectors.append((doc, mock_embed(text)))

    def search(self, query: str, k: int = 10) -> list[tuple[Doc, float]]:
        """Реализуй плотный поиск: получи эмбеддинг запроса, вычисли косинусное сходство со всеми проиндексированными документами и верни top-k по убыванию."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion
# ---------------------------------------------------------------------------

def rrf(
    rankings: list[list[tuple[Doc, float]]],
    k: int = 60,
    weights: list[float] | None = None,
) -> list[tuple[Doc, float]]:
    """Реализуй взвешенное Reciprocal Rank Fusion по идентификатору документа, проверь соответствие числа весов числу ранжирований и отсортируй объединённые результаты по итоговому голосу."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Hybrid retriever
# ---------------------------------------------------------------------------

@dataclass
class HybridRetriever:
    bm25: BM25Index = field(default_factory=BM25Index)
    dense: DenseIndex = field(default_factory=DenseIndex)
    rrf_k: int = 60
    bm25_weight: float = 1.0
    dense_weight: float = 1.0

    def add(self, doc: Doc) -> None:
        self.bm25.add(doc)
        self.dense.add(doc)

    def search(self, query: str, k_each: int = 10, k_out: int = 5) -> dict[str, list]:
        """Свяжи BM25 и dense-поиск: запроси top-k у обеих модальностей, объедини списки через RRF с настройками ретривера и ограничь fused-выдачу."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# fixture corpus and demo queries
# ---------------------------------------------------------------------------

CORPUS = [
    Doc("d1", "AbortMultipartOnFail",
        "Aborts an in-flight S3 multipart upload and decrements the per-bucket retry budget when "
        "the upload fails. Wired into the central retry budget configuration."),
    Doc("d2", "Uploading large files",
        "When you upload a large file the storage service splits it into parts. The client must "
        "track each part. If the network drops the partial upload can be resumed or cancelled "
        "depending on the resume window. Cancelled uploads do not block subsequent attempts."),
    Doc("d3", "Per-bucket budgets",
        "Each storage bucket carries a retry budget that limits how often a failed operation can "
        "be retried within a window. Budget exhaustion triggers a cooldown period."),
    Doc("d4", "check_permission",
        "Authorization is centralized in the check_permission function which evaluates a policy "
        "against the principal, the resource, and the action. Both human users and service "
        "accounts pass through the same function."),
    Doc("d5", "Policy engine",
        "The policy engine wraps an Open Policy Agent runtime and exposes evaluate. Cached for "
        "a configured TTL to amortize repeated lookups."),
    Doc("d6", "Search ranking",
        "Production search engines combine lexical and semantic retrieval through a rank fusion "
        "step. The fusion is rank-based, not score-based, so the two modalities can be combined "
        "without per-corpus calibration."),
    Doc("d7", "Index sizing",
        "The vector index sits in memory. Plan for 1 KB per vector at 256 dimensions in float32 "
        "and add a small overhead for the graph structure."),
]


def print_ranking(label: str, hits: Iterable[tuple[Doc, float]], top: int = 5) -> None:
    print(f"  {label}:")
    for i, (doc, score) in enumerate(list(hits)[:top]):
        print(f"    {i + 1}. {doc.doc_id} ({doc.title})  score={score:.4f}")


def main() -> None:
    retriever = HybridRetriever()
    for d in CORPUS:
        retriever.add(d)

    queries = [
        ("AbortMultipartOnFail",
         "literal symbol; BM25 wins easily, dense should still rank d1 high through hashed tokens"),
        ("how do we handle cancelled uploads",
         "paraphrased; dense should find the upload doc; BM25 less directly"),
        ("centralized authorization for service accounts",
         "mixed; both modalities should agree on the auth doc"),
    ]

    for q, note in queries:
        print(f"\nquery: {q}\nnote:  {note}")
        result = retriever.search(q, k_each=5, k_out=5)
        print_ranking("bm25 ", result["bm25"])
        print_ranking("dense", result["dense"])
        print_ranking("fused", result["fused"])


if __name__ == "__main__":
    main()
