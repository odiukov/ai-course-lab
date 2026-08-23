"""Streaming corpus downloader with resume, MinHash plus LSH dedup, and a shard manifest.

Pulls compressed shards from a list of URLs, streams them through a Zstandard
decompressor, iterates JSONL documents, fingerprints each document with MinHash,
buckets the signature with locality-sensitive hashing, drops near-duplicates,
and writes a per-corpus manifest.

The demo at the bottom builds a small synthetic corpus on disk, compresses it
with Zstandard, exposes it via a file URL, downloads it through this module,
and prints the manifest. Run: python3 code/main.py
"""

from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import os
import struct
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator

try:
    import zstandard as zstd
except ImportError as exc:
    raise SystemExit(
        "zstandard is required for this lesson. Install with: pip install zstandard"
    ) from exc


CHUNK_BYTES = 1 << 16
DEFAULT_NUM_HASHES = 128
DEFAULT_BANDS = 32
DEFAULT_SHINGLE_WIDTH = 5
MAX_UINT64 = (1 << 64) - 1
MERSENNE_PRIME = (1 << 61) - 1


@dataclass
class ShardPlan:
    """One row of the planned shard list."""

    shard_id: str
    url: str
    expected_size: int | None = None


@dataclass
class ShardResult:
    """Per-shard download and dedup outcome."""

    shard_id: str
    url: str
    raw_bytes: int
    decompressed_bytes: int
    document_count: int
    kept_count: int
    duplicate_count: int
    sha256: str

    def to_manifest_row(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class DocVerdict:
    """One document's dedup verdict."""

    shard_id: str
    doc_index: int
    verdict: str  # "keep" or "near_duplicate"
    collided_with: str | None = None  # "shard:doc" of the keeper


@dataclass
class CheckpointState:
    """Resume checkpoint persisted next to the shard."""

    url: str
    verified_bytes: int
    expected_size: int | None
    sha256_prefix_hex: str

    def to_json(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> "CheckpointState":
        data = json.loads(text)
        return cls(
            url=str(data["url"]),
            verified_bytes=int(data["verified_bytes"]),
            expected_size=(int(data["expected_size"]) if data.get("expected_size") is not None else None),
            sha256_prefix_hex=str(data["sha256_prefix_hex"]),
        )


def _hash_seed_pair(seed: int) -> tuple[int, int]:
    """Derive two 64-bit coefficients (a, b) from a seed.

    The signature uses universal hashing of the form ((a * x + b) mod p) mod 2^64.
    Two coefficients are derived deterministically from the seed so the family
    of hash functions is reproducible across runs and machines.
    """

    digest = hashlib.blake2b(seed.to_bytes(8, "little"), digest_size=16).digest()
    a = int.from_bytes(digest[:8], "little") | 1  # ensure a is non-zero
    b = int.from_bytes(digest[8:], "little")
    return a, b


class MinHasher:
    """MinHash signature builder with a fixed family of hash seeds."""

    def __init__(self, num_hashes: int = DEFAULT_NUM_HASHES, shingle_width: int = DEFAULT_SHINGLE_WIDTH) -> None:
        if num_hashes <= 0:
            raise ValueError("num_hashes must be positive")
        if shingle_width <= 0:
            raise ValueError("shingle_width must be positive")
        self.num_hashes = num_hashes
        self.shingle_width = shingle_width
        self._coefficients: list[tuple[int, int]] = [_hash_seed_pair(i) for i in range(num_hashes)]

    def shingles(self, text: str) -> list[str]:
        """Return overlapping whitespace-token shingles."""

        tokens = text.split()
        if len(tokens) < self.shingle_width:
            return [" ".join(tokens)] if tokens else []
        shingles: list[str] = []
        for start in range(len(tokens) - self.shingle_width + 1):
            shingles.append(" ".join(tokens[start : start + self.shingle_width]))
        return shingles

    @staticmethod
    def _hash_shingle(shingle: str) -> int:
        digest = hashlib.blake2b(shingle.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "little")

    def signature(self, text: str) -> list[int]:
        """Постройте MinHash-сигнатуру текста заданной длины по шинглам и фиксированному семейству хеш-функций, включая случай пустого текста."""
        raise NotImplementedError


class LSHIndex:
    """Locality-sensitive hashing index over MinHash signatures.

    Splits each signature into `bands` bands of `rows = num_hashes / bands` rows.
    Two signatures collide if they agree on at least one band. The collision
    probability is 1 - (1 - s^r)^b where s is Jaccard similarity, which gives
    a sharp threshold near s = (1/b)^(1/r). For (b=32, r=4) the threshold is
    near s = 0.42; for (b=20, r=5) it is near s = 0.55.
    """

    def __init__(self, num_hashes: int, bands: int = DEFAULT_BANDS) -> None:
        if bands <= 0 or num_hashes % bands != 0:
            raise ValueError(f"bands ({bands}) must divide num_hashes ({num_hashes})")
        self.num_hashes = num_hashes
        self.bands = bands
        self.rows = num_hashes // bands
        self._buckets: list[dict[bytes, list[str]]] = [{} for _ in range(bands)]
        self._signatures: dict[str, list[int]] = {}

    @staticmethod
    def _band_key(band: list[int]) -> bytes:
        return hashlib.blake2b(b"".join(struct.pack("<Q", v) for v in band), digest_size=16).digest()

    def query(self, signature: list[int]) -> str | None:
        """Найдите ранее добавленный документ, совпадающий с переданной MinHash-сигнатурой хотя бы в одной LSH-полосе."""
        raise NotImplementedError

    def insert(self, doc_id: str, signature: list[int]) -> None:
        self._signatures[doc_id] = signature
        for i in range(self.bands):
            band = signature[i * self.rows : (i + 1) * self.rows]
            key = self._band_key(band)
            self._buckets[i].setdefault(key, []).append(doc_id)

    def jaccard_estimate(self, doc_a: str, doc_b: str) -> float:
        """Return an unbiased Jaccard estimate between two indexed docs."""

        sig_a = self._signatures[doc_a]
        sig_b = self._signatures[doc_b]
        agree = sum(1 for a, b in zip(sig_a, sig_b) if a == b)
        return agree / self.num_hashes


class Dedup:
    """Combine MinHasher and LSHIndex into a streaming dedup."""

    def __init__(self, hasher: MinHasher, index: LSHIndex) -> None:
        self.hasher = hasher
        self.index = index

    def evaluate(self, shard_id: str, doc_index: int, text: str) -> DocVerdict:
        """Присвойте документу вердикт keep или near_duplicate, сохраняя новую сигнатуру в индексе и указывая идентификатор найденного оригинала."""
        raise NotImplementedError


class ZstdDocIterator:
    """Iterate JSONL documents from a Zstandard-compressed byte stream.

    Wraps the upstream reader in a Zstandard stream reader, then iterates one
    line per document. The decompressor never buffers the whole shard; it
    consumes the upstream incrementally.
    """

    def __init__(self, raw_reader: io.RawIOBase | io.BufferedIOBase) -> None:
        self._dctx = zstd.ZstdDecompressor()
        self._stream = self._dctx.stream_reader(raw_reader)
        self._text = io.TextIOWrapper(self._stream, encoding="utf-8", newline="")

    def __iter__(self) -> Iterator[str]:
        for line in self._text:
            line = line.rstrip("\n")
            if line:
                yield line


class StreamingDownloader:
    """Stream a remote URL to a local path with Range-resume and checkpointing.

    On every chunk the verified hash and byte count are advanced and the
    checkpoint is rewritten atomically. The checkpoint records the sha256
    prefix over the verified bytes, so a corrupted partial cannot be silently
    resumed.
    """

    def __init__(
        self,
        cache_dir: Path,
        opener: Callable[[urllib.request.Request], object] | None = None,
        chunk_bytes: int = CHUNK_BYTES,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.chunk_bytes = chunk_bytes
        self._opener = opener or urllib.request.urlopen

    def _paths_for(self, shard_id: str) -> tuple[Path, Path]:
        shard_path = self.cache_dir / f"{shard_id}.zst"
        checkpoint_path = self.cache_dir / f"{shard_id}.partial.json"
        return shard_path, checkpoint_path

    def _read_checkpoint(self, checkpoint_path: Path) -> CheckpointState | None:
        if not checkpoint_path.exists():
            return None
        try:
            return CheckpointState.from_json(checkpoint_path.read_text("utf-8"))
        except (json.JSONDecodeError, KeyError, ValueError):
            return None

    def _write_checkpoint(self, checkpoint_path: Path, state: CheckpointState) -> None:
        tmp = checkpoint_path.with_suffix(".json.tmp")
        tmp.write_text(state.to_json(), encoding="utf-8")
        os.replace(tmp, checkpoint_path)

    def _verify_partial(self, shard_path: Path, state: CheckpointState) -> bool:
        if not shard_path.exists():
            return False
        actual_size = shard_path.stat().st_size
        if actual_size != state.verified_bytes:
            return False
        hasher = hashlib.sha256()
        with shard_path.open("rb") as fh:
            remaining = state.verified_bytes
            while remaining > 0:
                buf = fh.read(min(self.chunk_bytes, remaining))
                if not buf:
                    return False
                hasher.update(buf)
                remaining -= len(buf)
        return hasher.hexdigest() == state.sha256_prefix_hex

    def download(self, plan: ShardPlan) -> ShardResult:
        """Реализуйте потоковую загрузку шарда с проверкой checkpoint, безопасным возобновлением через HTTP Range и подсчётом метаданных результата."""
        raise NotImplementedError


class ShardPlanner:
    """Turn a list of URLs into a planned shard list."""

    @staticmethod
    def from_urls(urls: Iterable[str]) -> list[ShardPlan]:
        plans: list[ShardPlan] = []
        for index, url in enumerate(urls):
            shard_id = f"shard-{index:04d}"
            plans.append(ShardPlan(shard_id=shard_id, url=url))
        return plans


class ManifestWriter:
    """Collect shard results into a manifest with its own content hash."""

    def __init__(self) -> None:
        self._rows: list[dict[str, object]] = []
        self._verdicts: list[dict[str, object]] = []

    def add_shard(self, result: ShardResult) -> None:
        self._rows.append(result.to_manifest_row())

    def add_verdict(self, verdict: DocVerdict) -> None:
        self._verdicts.append(asdict(verdict))

    def write(self, manifest_path: Path) -> str:
        """Запишите детерминированное содержимое manifest.json и соседний lock-файл с SHA-256 записанного манифеста."""
        raise NotImplementedError

    @property
    def shards(self) -> list[dict[str, object]]:
        return list(self._rows)

    @property
    def verdicts(self) -> list[dict[str, object]]:
        return list(self._verdicts)


def process_shard(
    plan: ShardPlan,
    downloader: StreamingDownloader,
    dedup: Dedup,
    manifest: ManifestWriter,
) -> ShardResult:
    """Download, decompress, dedup, and account for one shard."""

    result = downloader.download(plan)
    kept = 0
    duplicates = 0
    shard_path = downloader.cache_dir / f"{plan.shard_id}.zst"
    with shard_path.open("rb") as fh:
        for doc_index, line in enumerate(ZstdDocIterator(fh)):
            verdict = dedup.evaluate(plan.shard_id, doc_index, line)
            manifest.add_verdict(verdict)
            if verdict.verdict == "keep":
                kept += 1
            else:
                duplicates += 1
    result = dataclasses.replace(result, kept_count=kept, duplicate_count=duplicates)
    manifest.add_shard(result)
    return result


def build_demo_corpus(directory: Path) -> list[str]:
    """Build a tiny synthetic corpus with duplicates and write zst shards.

    Returns the list of file URLs the downloader should pull.
    """

    directory.mkdir(parents=True, exist_ok=True)
    base = [
        "the alignment problem is a story about reward functions and what we miss when we write them",
        "the alignment problem is a story about reward functions and the things we forget to write down",
        "transformers replaced recurrent networks because attention scales better with sequence length",
        "attention scales better with sequence length so transformers replaced recurrent networks",
        "evaluation harnesses keep training honest by treating the test corpus as a contract",
        "a contract between training and evaluation is what an eval harness ultimately enforces",
        "deduplication is upstream of tokenization so duplicates do not pay tokenization cost twice",
        "the tokenizer is a vocabulary contract between the model and the corpus",
        "checkpointing the verified bytes before writing the buffer is the only safe resume order",
        "the manifest is the deciding edge between data is downloaded and data is verifiable",
    ]
    shards = [base[:5], base[3:9], base[6:]]
    urls: list[str] = []
    for i, group in enumerate(shards):
        payload = ("\n".join(group) + "\n").encode("utf-8")
        compressed = zstd.ZstdCompressor(level=10).compress(payload)
        path = directory / f"corpus-{i:02d}.zst"
        path.write_bytes(compressed)
        urls.append(path.as_uri())
    return urls


def run_demo() -> int:
    with tempfile.TemporaryDirectory() as raw_dir, tempfile.TemporaryDirectory() as cache_dir:
        corpus_dir = Path(raw_dir)
        cache_path = Path(cache_dir)
        urls = build_demo_corpus(corpus_dir)
        plans = ShardPlanner.from_urls(urls)
        downloader = StreamingDownloader(cache_dir=cache_path)
        hasher = MinHasher(num_hashes=128, shingle_width=3)
        index = LSHIndex(num_hashes=128, bands=32)
        dedup = Dedup(hasher=hasher, index=index)
        manifest = ManifestWriter()
        for plan in plans:
            result = process_shard(plan, downloader, dedup, manifest)
            print(
                f"[shard] {result.shard_id} docs={result.document_count} "
                f"kept={result.kept_count} duplicates={result.duplicate_count} "
                f"sha256={result.sha256[:12]}"
            )
        manifest_path = cache_path / "manifest.json"
        manifest_sha = manifest.write(manifest_path)
        kept = sum(int(row["kept_count"]) for row in manifest.shards)
        dup = sum(int(row["duplicate_count"]) for row in manifest.shards)
        print(f"[manifest] sha256={manifest_sha[:12]} kept={kept} duplicates={dup}")
    return 0


if __name__ == "__main__":
    sys.exit(run_demo())
