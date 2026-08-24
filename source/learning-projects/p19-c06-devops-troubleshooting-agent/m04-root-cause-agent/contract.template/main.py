"""DevOps troubleshooting agent — K8s knowledge graph + HITL approval gate.

The hard architectural primitives are (a) a K8s knowledge graph that lets
root-cause analysis walk from an alerted object to its neighbors with
telemetry overlays, and (b) a read-only-by-default tool surface where every
destructive command is gated by a human-in-the-loop approval and every
considered command is audit-logged. This scaffold implements both.

Run:  python main.py
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# K8s knowledge graph  --  objects + telemetry overlay edges
# ---------------------------------------------------------------------------

@dataclass
class Node:
    kind: str               # "Pod" | "Deployment" | "Node" | "Service" | "Prom" | "Loki"
    name: str
    attrs: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.kind}/{self.name}"


@dataclass
class Graph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[tuple[str, str, str]] = field(default_factory=list)  # (src, rel, dst)

    def add(self, n: Node) -> None:
        self.nodes[n.key] = n

    def link(self, src: str, rel: str, dst: str) -> None:
        self.edges.append((src, rel, dst))

    def neighbors(self, key: str) -> list[tuple[str, str]]:
        out = [(rel, dst) for s, rel, dst in self.edges if s == key]
        out += [(rel, src) for src, rel, dst in self.edges if dst == key]
        return out


def build_sample_cluster() -> Graph:
    g = Graph()
    dep = Node("Deployment", "checkout-api",
               {"revision": 42, "image": "checkout-api:v2.41", "deployed_at": "14m ago"})
    rs = Node("ReplicaSet", "checkout-api-abc")
    node = Node("Node", "ip-10-2-3-4", {"kernel": "6.1.109"})
    pods = [Node("Pod", f"checkout-api-abc-{i}", {"phase": "Running"}) for i in range(3)]
    svc = Node("Service", "checkout-api")
    prom = Node("Prom", "error_rate{deployment=checkout-api}",
                {"last_15m": "mean=0.14 up_trend", "threshold": 0.05})
    loki = Node("Loki", "namespace=prod,app=checkout-api",
                {"last_15m": "500 errors on /api/v2/pay, stack = NullHealthz"})

    for n in (dep, rs, node, svc, prom, loki, *pods):
        g.add(n)
    g.link(dep.key, "OWNS", rs.key)
    for p in pods:
        g.link(rs.key, "OWNS", p.key)
        g.link(p.key, "SCHEDULED_ON", node.key)
    g.link(svc.key, "EXPOSES", dep.key)
    g.link(dep.key, "OBSERVED_BY", prom.key)
    g.link(dep.key, "OBSERVED_BY", loki.key)
    return g


# ---------------------------------------------------------------------------
# hypothesis ranking  --  recency * specificity * citation count
# ---------------------------------------------------------------------------

@dataclass
class Hypothesis:
    title: str
    citations: list[str]
    recency_mins: int
    specificity: float     # 0..1
    path_len: int

    def score(self) -> float:
        recency_w = max(0.0, 1.0 - self.recency_mins / 60.0)
        path_w = 1.0 / (1 + self.path_len)
        return (recency_w * 0.35 +
                self.specificity * 0.35 +
                min(len(self.citations), 5) / 5 * 0.2 +
                path_w * 0.1)


def root_cause(g: Graph, alerted: str) -> list[Hypothesis]:
    """Реализуй контракт этапа «Граф расследования»."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# approval gate + audit log  --  every considered command tracked
# ---------------------------------------------------------------------------

@dataclass
class AuditEvent:
    ts: float
    tool: str
    args: dict
    considered: bool = True
    approved: bool = False
    executed: bool = False
    approver: str | None = None
    result: str | None = None


@dataclass
class Agent:
    graph: Graph
    audit: list[AuditEvent] = field(default_factory=list)
    read_only_tools: tuple = ("kubectl_get", "kubectl_describe", "promql", "logql", "traceql")
    destructive_tools: tuple = ("kubectl_scale", "kubectl_rollback", "kubectl_delete", "argocd_rollback")

    def call(self, tool: str, args: dict, approver: str | None = None) -> AuditEvent:
        ev = AuditEvent(ts=time.time(), tool=tool, args=args)
        if tool in self.read_only_tools:
            ev.executed = True
            ev.result = "ok (read-only)"
        elif tool in self.destructive_tools:
            if approver:
                ev.approved = True
                ev.approver = approver
                ev.executed = True
                ev.result = f"executed by {approver}"
            else:
                ev.result = "blocked: no slack approval"
        else:
            ev.result = "blocked: unknown tool"
        self.audit.append(ev)
        return ev


# ---------------------------------------------------------------------------
# demo  --  full alert -> graph walk -> ranked hypotheses -> slack gate
# ---------------------------------------------------------------------------

def main() -> None:
    g = build_sample_cluster()
    agent = Agent(graph=g)

    alerted = "Deployment/checkout-api"
    print(f"=== alert received: {alerted} (error rate 14%) ===")

    # agent pulls read-only telemetry first
    agent.call("promql", {"query": "rate(http_requests_total{status=~'5..'}[5m])"})
    agent.call("logql", {"query": '{app="checkout-api"} |~ "stack"'})

    hyps = root_cause(g, alerted)
    print("\nranked hypotheses:")
    for i, h in enumerate(hyps, 1):
        print(f"  #{i} score={h.score():.3f}  {h.title}")
        print(f"     citations: {h.citations}")

    # agent proposes rollback but must wait for slack approval
    print("\nproposing remediation:")
    ev = agent.call("argocd_rollback", {"app": "checkout-api", "to_revision": 41})
    print(f"  {ev.tool}: {ev.result}")

    # slack approved -> agent executes
    print("\nslack approval granted by alice@sre")
    ev = agent.call("argocd_rollback",
                    {"app": "checkout-api", "to_revision": 41},
                    approver="alice@sre")
    print(f"  {ev.tool}: {ev.result}")

    print("\naudit log:")
    for ev in agent.audit:
        print(" ", json.dumps({
            "tool": ev.tool, "executed": ev.executed,
            "approved": ev.approved, "approver": ev.approver,
            "result": ev.result,
        }))


if __name__ == "__main__":
    main()
