"""Sharded checkpoint with atomic write and verified resume.

Saves a multi-rank training state as per-rank binary files plus a JSON
manifest. The write is atomic: every file lands at <name>.tmp first, the
manifest writes last, then a single rename moves everything to the final
names. A crash mid-write leaves the previous checkpoint intact.

Resume verifies the manifest schema (world_size, shard count, sha256 per
shard) and reconstructs per-rank state byte-equal to what was saved.

Run: python3 code/main.py
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

import torch


SCHEMA_VERSION = 1
MANIFEST_NAME = "manifest.json"


@dataclass
class ShardEntry:
    rank: int
    path: str
    sha256: str
    param_shard_offset: int
    param_shard_numel: int


@dataclass
class ShardManifest:
    world_size: int
    step: int
    wall_clock_seconds: float
    shards: list
    schema_version: int = SCHEMA_VERSION

    def to_json(self) -> str:
        """Сериализуйте манифест и все записи шардов в стабильный JSON заданной схемы."""
        raise NotImplementedError

    @classmethod
    def from_json(cls, text: str) -> "ShardManifest":
        """Разберите JSON манифеста, восстановив типизированные поля и объекты ShardEntry."""
        raise NotImplementedError


class CheckpointError(Exception):
    """Raised when manifest validation or shard verification fails."""


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fsync_dir(path: Path) -> None:
    """Fsync a directory so rename metadata reaches disk; no-op where unsupported."""
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _serialize_state(state: dict) -> bytes:
    """Serialize a state dict deterministically using torch.save with pickle 4."""
    import io
    buf = io.BytesIO()
    torch.save(state, buf, pickle_protocol=4)
    return buf.getvalue()


def _deserialize_state(data: bytes) -> dict:
    import io
    buf = io.BytesIO(data)
    return torch.load(buf, weights_only=False)


def save_sharded(per_rank_state: list, dest_dir: str, step: int,
                 wall_clock_seconds: float = 0.0) -> ShardManifest:
    """Сохраните состояния рангов в отдельные шарды, вычислите метаданные и опубликуйте файлы с атомарной схемой временной записи и переименования."""
    raise NotImplementedError


def load_sharded(src_dir: str, expected_world_size: int) -> tuple:
    """Загрузите манифест и шарды, отклоняя несовместимый world size, неверную схему, неполный состав рангов, небезопасные пути, отсутствующие файлы и несовпадающие SHA-256."""
    raise NotImplementedError


def rotate_checkpoints(parent_dir: str, keep_last: int = 5) -> list:
    """Delete oldest checkpoint directories so only the most recent keep_last remain."""
    if keep_last < 0:
        raise ValueError(f"keep_last must be >= 0, got {keep_last}")
    parent = Path(parent_dir)
    if not parent.exists():
        return []
    children = sorted(
        [c for c in parent.iterdir() if c.is_dir() and c.name.startswith("step_")],
        key=lambda c: (c.stat().st_mtime, c.name),
    )
    if keep_last == 0:
        to_delete = children
    elif len(children) > keep_last:
        to_delete = children[:-keep_last]
    else:
        to_delete = []
    deleted = []
    for c in to_delete:
        shutil.rmtree(c, ignore_errors=True)
        deleted.append(c.name)
    return deleted


def make_demo_state(rank: int, world_size: int) -> dict:
    """Construct a representative per-rank state for the demo."""
    torch.manual_seed(31 + rank)
    return {
        "rank": rank,
        "world_size": world_size,
        "param_shard": torch.randn(1024) + rank,
        "m_shard": torch.zeros(1024),
        "v_shard": torch.ones(1024) * 1e-6,
        "step": 100,
    }


def main() -> int:
    world_size = 4
    workdir = tempfile.mkdtemp(prefix="aie_ckpt_")
    print(f"workdir: {workdir}")
    states = [make_demo_state(r, world_size) for r in range(world_size)]
    step_dir = os.path.join(workdir, "step_0100")
    print("saving sharded checkpoint...")
    manifest = save_sharded(states, step_dir, step=100, wall_clock_seconds=42.0)
    print(f"manifest: world_size={manifest.world_size}, step={manifest.step}, shards={len(manifest.shards)}")
    for entry in manifest.shards:
        print(f"  rank {entry.rank}: {entry.path} sha256={entry.sha256[:12]}... numel={entry.param_shard_numel}")
    print("\nresuming...")
    loaded_manifest, loaded_states = load_sharded(step_dir, expected_world_size=world_size)
    for r in range(world_size):
        before = states[r]["param_shard"]
        after = loaded_states[r]["param_shard"]
        assert torch.equal(before, after), f"rank {r} param shard differs after resume"
    print("byte-equal round-trip verified for every rank")
    print("\ntesting failure mode: wrong world size...")
    try:
        load_sharded(step_dir, expected_world_size=8)
    except CheckpointError as e:
        print(f"  rejected as expected: {e}")
    print("\ntesting failure mode: tampered shard...")
    shard0 = Path(step_dir) / "rank0.bin"
    backup = shard0.read_bytes()
    shard0.write_bytes(backup + b"corruption")
    try:
        load_sharded(step_dir, expected_world_size=world_size)
    except CheckpointError as e:
        print(f"  rejected as expected: {e}")
    shard0.write_bytes(backup)
    print("\ntesting rotation: write 8 checkpoints, keep 5...")
    for s in range(8):
        sd = os.path.join(workdir, f"step_{s:04d}")
        save_sharded(states, sd, step=s)
    deleted = rotate_checkpoints(workdir, keep_last=5)
    print(f"  rotated {len(deleted)} oldest: {deleted}")
    shutil.rmtree(workdir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
