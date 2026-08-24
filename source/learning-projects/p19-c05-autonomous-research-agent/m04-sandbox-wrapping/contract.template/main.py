"""Autonomous research agent — plan/execute/verify tree search scaffold.

The hard architectural primitive is best-first tree search over experiment
nodes with budgeted expansion, per-node sandboxed execution, and a novelty x
quality x budget scoring function. The LLM planner and the actual PyTorch
experiments are stubbed so the tree-search skeleton is observable end to end
without real compute.

Run:  python main.py
"""

from __future__ import annotations

import heapq
import random
from dataclasses import dataclass, field
from typing import Iterable


# ---------------------------------------------------------------------------
# experiment node  --  (hypothesis, config, result) tuple
# ---------------------------------------------------------------------------

@dataclass
class Node:
    node_id: int
    parent: int | None
    hypothesis: str
    config: dict[str, object]
    result: dict[str, float] = field(default_factory=dict)
    cost_usd: float = 0.0
    novelty: float = 0.5
    quality: float = 0.0
    failure: str | None = None

    def score(self, remaining_budget: float) -> float:
        budget_weight = min(1.0, remaining_budget / 10.0)
        return self.novelty * 0.4 + self.quality * 0.5 + budget_weight * 0.1


# ---------------------------------------------------------------------------
# stub planner  --  proposes child nodes by small-edit expansion
# ---------------------------------------------------------------------------

def expand(node: Node, next_id: int) -> list[Node]:
    """Propose children by varying one config dimension at a time."""
    children: list[Node] = []
    base_cfg = node.config
    # vary sparsity
    for sp in (4, 8, 16):
        cfg = dict(base_cfg, sparsity_top=sp)
        children.append(Node(node_id=next_id, parent=node.node_id,
                             hypothesis=f"sparsity top-{sp}",
                             config=cfg))
        next_id += 1
    # vary learning rate
    for lr in (3e-4, 1e-3):
        cfg = dict(base_cfg, lr=lr)
        children.append(Node(node_id=next_id, parent=node.node_id,
                             hypothesis=f"lr={lr}",
                             config=cfg))
        next_id += 1
    return children


# ---------------------------------------------------------------------------
# sandbox execution  --  stubbed; returns fake but reproducible metrics
# ---------------------------------------------------------------------------

def run_experiment(node: Node, rng: random.Random) -> None:
    """Реализуй контракт этапа «Изолируй каждый эксперимент»."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# verify step  --  sanity check results before scoring
# ---------------------------------------------------------------------------

def verify(node: Node) -> bool:
    if node.failure:
        return False
    if node.result.get("loss", 99) > 4.0:
        node.failure = "loss_diverged"
        return False
    return True


# ---------------------------------------------------------------------------
# tree search  --  best-first with budget and max depth
# ---------------------------------------------------------------------------

@dataclass
class Tree:
    root: Node
    nodes: dict[int, Node] = field(default_factory=dict)
    frontier: list = field(default_factory=list)  # (neg_score, counter, node_id)
    counter: int = 0
    budget: float = 30.0
    spent: float = 0.0
    max_nodes: int = 24

    def push(self, node: Node) -> None:
        self.nodes[node.node_id] = node
        self.counter += 1
        remaining = self.budget - self.spent
        heapq.heappush(self.frontier, (-node.score(remaining), self.counter, node.node_id))

    def pop(self) -> Node | None:
        while self.frontier:
            _, _, nid = heapq.heappop(self.frontier)
            return self.nodes[nid]
        return None


def tree_search(seed: str, rng: random.Random) -> Tree:
    root = Node(node_id=0, parent=None, hypothesis=seed, config={"sparsity_top": 8, "lr": 3e-4})
    root.novelty = 1.0
    root.quality = 0.5
    tree = Tree(root=root)
    tree.push(root)

    next_id = 1
    while tree.frontier and len(tree.nodes) < tree.max_nodes:
        cur = tree.pop()
        if cur is None:
            break
        if tree.spent >= tree.budget:
            print(f"    BUDGET EXHAUSTED at ${tree.spent:.2f}")
            break
        if cur.node_id != 0:
            run_experiment(cur, rng)
            tree.spent += cur.cost_usd
            ok = verify(cur)
            flag = "ok " if ok else "FAIL"
            print(f"    [{flag}] node #{cur.node_id:02d}  hypo='{cur.hypothesis}'  "
                  f"loss={cur.result.get('loss','?'):>5}  "
                  f"$={cur.cost_usd:.2f}  cum=${tree.spent:.2f}")
            if not ok:
                continue
        # expand the top promising nodes
        children = expand(cur, next_id)
        next_id += len(children)
        for ch in children:
            tree.push(ch)

    return tree


# ---------------------------------------------------------------------------
# best-branch selection and write-up stub
# ---------------------------------------------------------------------------

def best_branch(tree: Tree) -> list[Node]:
    done = [n for n in tree.nodes.values() if n.result and not n.failure]
    if not done:
        return []
    best = max(done, key=lambda n: n.quality)
    # walk back to root
    chain = [best]
    while chain[-1].parent is not None:
        chain.append(tree.nodes[chain[-1].parent])
    return list(reversed(chain))


def main() -> None:
    print("=== autonomous research agent: tree search (budget $30) ===")
    rng = random.Random(7)
    seed = "investigate sparsity patterns in attention maps of sub-1B transformers"
    tree = tree_search(seed, rng)
    print()
    print(f"nodes explored : {len(tree.nodes)}")
    print(f"budget spent   : ${tree.spent:.2f} of ${tree.budget:.2f}")
    print(f"failed nodes   : {sum(1 for n in tree.nodes.values() if n.failure)}")

    branch = best_branch(tree)
    print(f"\nbest branch (length {len(branch)}):")
    for n in branch:
        print(f"  #{n.node_id:02d} {n.hypothesis}   q={n.quality:.2f}  loss={n.result.get('loss','?')}")

    print("\n(writer + reviewer + red-team steps would run here; "
          "stubbed for the scaffold)")


if __name__ == "__main__":
    main()
