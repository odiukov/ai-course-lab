"""DistributedDataParallel from scratch on the gloo backend.

Wraps an nn.Module so that:
  * at construct time every rank's parameters are broadcast from rank 0 and so
    every rank starts with identical weights,
  * after backward each parameter's gradient is allreduced (sum) and divided
    by world_size, producing the mean gradient every rank steps on.

The demo trains a 3-layer MLP for 20 steps on synthetic data across 4 ranks
and compares the resulting per-step loss against a single-process reference
that walks the same batches in rank order. The two paths produce identical
loss curves to float epsilon, which is the load-bearing correctness test.

Run: python3 code/main.py
"""

from __future__ import annotations

import multiprocessing as mp
import os
import sys
import tempfile

import torch
import torch.distributed as dist
import torch.nn as nn


SEED = 7
WORLD_SIZE = 4
STEPS = 20
BATCH = 8
IN_DIM = 16
HID_DIM = 32
OUT_DIM = 4


def _loopback_iface() -> str:
    return "lo0" if sys.platform == "darwin" else "lo"


class MiniMLP(nn.Module):
    """Small enough to converge in seconds, big enough to expose DDP wiring."""

    def __init__(self, in_dim: int = IN_DIM, hid_dim: int = HID_DIM, out_dim: int = OUT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hid_dim),
            nn.ReLU(),
            nn.Linear(hid_dim, hid_dim),
            nn.ReLU(),
            nn.Linear(hid_dim, out_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class DistributedDataParallel:
    """Broadcast params at init, allreduce-and-mean grads after backward.

    Not a full nn.Module wrapper; the API exposes the two methods the training
    loop needs (sync_init, sync_grads). The wrap is intentionally thin so the
    cost of each operation is visible in the loop.
    """

    def __init__(self, module: nn.Module, world_size: int):
        self.module = module
        self.world_size = world_size
        self._broadcast_params()

    def _broadcast_params(self) -> None:
        """Синхронизируй начальные параметры всех реплик, передав значения модели с rank 0 остальным процессам."""
        raise NotImplementedError

    def sync_grads(self) -> None:
        """Синхронизируй существующие градиенты параметров между rank и нормализуй результат так, чтобы шаг оптимизатора не зависел от world_size."""
        raise NotImplementedError

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.module(x)

    def parameters(self):
        return self.module.parameters()


def make_dataset(seed: int, n_total: int) -> tuple:
    """Synthetic regression dataset shared by every rank's reference loop."""
    g = torch.Generator().manual_seed(seed)
    x = torch.randn(n_total, IN_DIM, generator=g)
    w = torch.randn(IN_DIM, OUT_DIM, generator=g)
    y = x @ w + 0.1 * torch.randn(n_total, OUT_DIM, generator=g)
    return x, y


def _ddp_worker(rank: int, world_size: int, init_file: str, iface: str,
                steps: int, batch: int, lr: float, out_queue) -> None:
    """Реализуй полный цикл одного DDP-процесса: инициализацию gloo, выбор локального среза данных, обучение с синхронизацией градиентов и возврат метрик."""
    raise NotImplementedError


def run_ddp(world_size: int = WORLD_SIZE, steps: int = STEPS,
            batch: int = BATCH, lr: float = 0.05) -> tuple:
    """Spawn world_size ranks, return per-rank loss history and param norm."""
    ctx = mp.get_context("spawn")
    out_queue = ctx.Queue()
    init_dir = tempfile.mkdtemp(prefix="aie_ddp_")
    init_file = os.path.join(init_dir, "rendezvous")
    iface = _loopback_iface()
    procs = []
    try:
        for r in range(world_size):
            p = ctx.Process(
                target=_ddp_worker,
                args=(r, world_size, init_file, iface, steps, batch, lr, out_queue),
            )
            p.start()
            procs.append(p)
        results = {}
        for _ in range(world_size):
            rank, losses, norm = out_queue.get(timeout=120)
            results[rank] = (losses, norm)
        return results
    finally:
        for p in procs:
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)
        try:
            os.remove(init_file)
        except FileNotFoundError:
            pass
        try:
            os.rmdir(init_dir)
        except OSError:
            pass


def reference_single_process(world_size: int = WORLD_SIZE, steps: int = STEPS,
                             batch: int = BATCH, lr: float = 0.05) -> tuple:
    """Реализуй однопроцессный эталон, который на каждом шаге последовательно накапливает вклад всех rank и возвращает сопоставимые потери и норму параметров."""
    raise NotImplementedError


def main() -> int:
    print(f"world_size={WORLD_SIZE}, steps={STEPS}, batch={BATCH}, model=MiniMLP")
    print("running DDP across ranks...")
    ddp_results = run_ddp()
    print("running single-process reference...")
    ref_losses, ref_norm = reference_single_process()
    print(f"\n{'step':<6}{'ref_loss':<14}{'ddp_rank0':<14}{'ddp_rank3':<14}{'rank_drift':<14}")
    rank0_losses, rank0_norm = ddp_results[0]
    rank3_losses, _ = ddp_results[WORLD_SIZE - 1]
    for s in range(STEPS):
        drift = abs(rank0_losses[s] - rank3_losses[s])
        print(f"{s:<6}{ref_losses[s]:<14.6f}{rank0_losses[s]:<14.6f}{rank3_losses[s]:<14.6f}{drift:<14.2e}")
    print(f"\nfinal param norm: ref={ref_norm:.6f}, ddp_rank0={rank0_norm:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
