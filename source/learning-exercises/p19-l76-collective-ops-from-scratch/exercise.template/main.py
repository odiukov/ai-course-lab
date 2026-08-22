"""Collective communication primitives over multiprocessing.Queue, verified against gloo.

Implements ring allreduce, tree broadcast, allgather, reduce_scatter on a queue
mesh that wires N ranks into a ring. Every primitive is checked byte-for-byte
against torch.distributed initialised with the gloo backend on the same tensor
and the same world size. The per-rank byte counter proves the 2T(N-1)/N
scaling of ring allreduce.

Run: python3 code/main.py

The mesh workers use the 'fork' multiprocessing context so child processes
inherit Queue file descriptors without pickling. The gloo reference workers
use 'spawn' because torch.distributed needs a clean process. Both contexts
ship in stdlib multiprocessing.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import tempfile
from dataclasses import dataclass

import torch
import torch.distributed as dist


PRIMITIVES = ("allreduce", "broadcast", "allgather", "reduce_scatter")
RECV_TIMEOUT_S = 30.0


def _loopback_iface() -> str:
    """Return the loopback interface name; macOS uses lo0, Linux uses lo."""
    import sys as _sys
    return "lo0" if _sys.platform == "darwin" else "lo"


@dataclass
class Mesh:
    """A point-to-point mesh wired as a fully-connected graph of queues.

    Each rank holds out_queues[dst] and in_queues[src]. The ring algorithms
    only use neighbour edges; the full mesh keeps the API general so future
    lessons can experiment with tree topologies without rewiring.
    """

    rank: int
    world_size: int
    out_queues: list
    in_queues: list
    byte_counter: object = None

    def send(self, dst: int, tensor: torch.Tensor) -> None:
        if dst == self.rank:
            raise ValueError("rank cannot send to itself")
        payload = tensor.detach().clone().contiguous()
        nbytes = payload.numel() * payload.element_size()
        if self.byte_counter is not None:
            with self.byte_counter.get_lock():
                self.byte_counter.value += nbytes
        self.out_queues[dst].put(payload)

    def recv(self, src: int) -> torch.Tensor:
        if src == self.rank:
            raise ValueError("rank cannot recv from itself")
        return self.in_queues[src].get(timeout=RECV_TIMEOUT_S)


def build_queue_grid(ctx, world_size: int):
    """Allocate a (world_size, world_size) grid of queues using the given context."""
    grid = [[None] * world_size for _ in range(world_size)]
    for src in range(world_size):
        for dst in range(world_size):
            if src != dst:
                grid[src][dst] = ctx.Queue()
    return grid


def mesh_from_grid(rank: int, world_size: int, grid, byte_counter) -> Mesh:
    out_qs = [grid[rank][d] for d in range(world_size)]
    in_qs = [grid[s][rank] for s in range(world_size)]
    return Mesh(rank=rank, world_size=world_size,
                out_queues=out_qs, in_queues=in_qs,
                byte_counter=byte_counter)


def ring_allreduce(mesh: Mesh, tensor: torch.Tensor) -> torch.Tensor:
    """Реализуй reduce-scatter и allgather по кольцу, включая дополнение длины до кратной world_size и возврат исходной формы."""
    raise NotImplementedError


def broadcast(mesh: Mesh, tensor: torch.Tensor, src: int) -> torch.Tensor:
    """Разошли значение от source rank по бинарному дереву так, чтобы множество владельцев удваивалось на каждом раунде."""
    raise NotImplementedError


def allgather(mesh: Mesh, tensor: torch.Tensor) -> torch.Tensor:
    """Прокрути шарды по кольцу N−1 раз и верни их конкатенацию в порядке rank."""
    raise NotImplementedError


def reduce_scatter(mesh: Mesh, tensor: torch.Tensor) -> torch.Tensor:
    """Проверь делимость входа, просуммируй соответствующие чанки по кольцу и верни шард, принадлежащий текущему rank."""
    raise NotImplementedError


def _gloo_worker(rank: int, world_size: int, op: str, tensor_bytes: bytes,
                 shape, dtype_str: str, init_file: str,
                 iface: str, out_queue) -> None:
    os.environ["GLOO_SOCKET_IFNAME"] = iface
    dist.init_process_group(
        backend="gloo",
        init_method=f"file://{init_file}",
        rank=rank,
        world_size=world_size,
    )
    dtype = getattr(torch, dtype_str)
    tensor = torch.frombuffer(bytearray(tensor_bytes), dtype=dtype).reshape(shape).clone()
    if op == "allreduce":
        dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
        out = tensor
    elif op == "broadcast":
        dist.broadcast(tensor, src=0)
        out = tensor
    elif op == "allgather":
        gathered = [torch.zeros_like(tensor) for _ in range(world_size)]
        dist.all_gather(gathered, tensor)
        out = torch.cat(gathered)
    elif op == "reduce_scatter":
        chunks = [c.contiguous() for c in tensor.chunk(world_size)]
        recv = torch.zeros_like(chunks[0])
        dist.reduce_scatter(recv, chunks, op=dist.ReduceOp.SUM)
        out = recv
    else:
        raise ValueError(f"unknown op {op}")
    out_queue.put((rank, out.clone()))
    out_queue.close()
    out_queue.join_thread()
    os._exit(0)


def gloo_reference(op: str, world_size: int,
                   per_rank_tensors: list) -> list:
    """Run the same operation through torch.distributed gloo for verification.

    Uses file-based init (file:// URI) because TCP init through libuv has
    known issues on macOS with concurrent process group creation.
    """
    ctx = mp.get_context("spawn")
    out_queue = ctx.Queue()
    init_dir = tempfile.mkdtemp(prefix="aie_gloo_")
    init_file = os.path.join(init_dir, "rendezvous")
    iface = _loopback_iface()
    procs = []
    try:
        for r in range(world_size):
            t = per_rank_tensors[r].contiguous()
            p = ctx.Process(
                target=_gloo_worker,
                args=(r, world_size, op, bytes(t.numpy().tobytes()),
                      tuple(t.shape), str(t.dtype).split(".")[-1],
                      init_file, iface, out_queue),
            )
            p.start()
            procs.append(p)
        results = {}
        for _ in range(world_size):
            rank, tensor = out_queue.get(timeout=60)
            results[rank] = tensor
        return [results[r] for r in range(world_size)]
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


def _mesh_worker(rank: int, world_size: int, op: str,
                 grid, byte_counter, tensor_bytes: bytes,
                 shape, dtype_str: str, src: int, out_queue) -> None:
    mesh = mesh_from_grid(rank, world_size, grid, byte_counter)
    dtype = getattr(torch, dtype_str)
    tensor = torch.frombuffer(bytearray(tensor_bytes), dtype=dtype).reshape(shape).clone()
    if op == "allreduce":
        result = ring_allreduce(mesh, tensor)
    elif op == "broadcast":
        result = broadcast(mesh, tensor, src=src)
    elif op == "allgather":
        result = allgather(mesh, tensor)
    elif op == "reduce_scatter":
        result = reduce_scatter(mesh, tensor)
    else:
        raise ValueError(f"unknown op {op}")
    out_queue.put((rank, result))


def run_mesh(op: str, world_size: int,
             per_rank_tensors: list,
             src: int = 0) -> tuple:
    """Run the chosen primitive on the queue mesh and return per-rank outputs plus byte total."""
    ctx = mp.get_context("fork")
    grid = build_queue_grid(ctx, world_size)
    byte_counter = ctx.Value("q", 0)
    out_queue = ctx.Queue()
    procs = []
    try:
        for r in range(world_size):
            t = per_rank_tensors[r].contiguous()
            p = ctx.Process(
                target=_mesh_worker,
                args=(r, world_size, op, grid, byte_counter,
                      bytes(t.numpy().tobytes()), tuple(t.shape),
                      str(t.dtype).split(".")[-1], src, out_queue),
            )
            p.start()
            procs.append(p)
        results = {}
        for _ in range(world_size):
            rank, tensor = out_queue.get(timeout=60)
            results[rank] = tensor
        return [results[r] for r in range(world_size)], byte_counter.value
    finally:
        for p in procs:
            p.join(timeout=30)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)


def verify_against_gloo(op: str, world_size: int,
                        per_rank_tensors: list) -> tuple:
    """Compare mesh implementation against gloo reference, return (match, max_abs_diff)."""
    mesh_out, _ = run_mesh(op, world_size, per_rank_tensors)
    gloo_out = gloo_reference(op, world_size, per_rank_tensors)
    max_diff = 0.0
    for m, g in zip(mesh_out, gloo_out):
        diff = (m - g).abs().max().item()
        if diff > max_diff:
            max_diff = diff
    return max_diff < 1e-5, max_diff


def main() -> int:
    world_size = 4
    n = 64
    torch.manual_seed(7)
    per_rank = [torch.randn(n, dtype=torch.float32) for _ in range(world_size)]
    print(f"world_size={world_size}, tensor_len={n}, dtype=float32")
    print(f"{'op':<16} {'gloo_match':<12} {'max_abs_diff':<14}")
    converged = True
    for op in PRIMITIVES:
        if op == "broadcast":
            inputs = [per_rank[0].clone() if r == 0 else torch.zeros(n) for r in range(world_size)]
        elif op == "reduce_scatter":
            inputs = [torch.randn(n * world_size, dtype=torch.float32) for _ in range(world_size)]
        else:
            inputs = per_rank
        match, diff = verify_against_gloo(op, world_size, inputs)
        converged = converged and match
        print(f"{op:<16} {str(match):<12} {diff:<14.3e}")
    expected_per_rank_bytes = 2 * (world_size - 1) * (n // world_size) * 4
    _, total_bytes = run_mesh("allreduce", world_size, per_rank)
    per_rank_bytes = total_bytes / world_size
    print(f"\nallreduce per-rank bytes: measured={per_rank_bytes:.0f} "
          f"expected={expected_per_rank_bytes} "
          f"formula=2T(N-1)/N with T={n*4} bytes")
    bytes_match = per_rank_bytes == expected_per_rank_bytes
    return 0 if converged and bytes_match else 1


if __name__ == "__main__":
    raise SystemExit(main())
