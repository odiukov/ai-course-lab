import unittest
from collections import Counter
from unittest import mock

import main


class TestBuildSampleCluster(unittest.TestCase):
    def test_expected_nodes_and_attributes(self):
        graph = main.build_sample_cluster()

        self.assertIsInstance(graph, main.Graph)
        self.assertEqual(
            set(graph.nodes),
            {
                "Deployment/checkout-api",
                "ReplicaSet/checkout-api-abc",
                "Node/ip-10-2-3-4",
                "Pod/checkout-api-abc-0",
                "Pod/checkout-api-abc-1",
                "Pod/checkout-api-abc-2",
                "Service/checkout-api",
                "Prom/error_rate{deployment=checkout-api}",
                "Loki/namespace=prod,app=checkout-api",
            },
        )
        deployment = graph.nodes["Deployment/checkout-api"]
        self.assertEqual(deployment.attrs["revision"], 42)
        self.assertEqual(deployment.attrs["image"], "checkout-api:v2.41")
        self.assertEqual(deployment.attrs["deployed_at"], "14m ago")
        self.assertTrue(
            all(
                graph.nodes[f"Pod/checkout-api-abc-{index}"].attrs["phase"] == "Running"
                for index in range(3)
            )
        )

    def test_expected_relationships_without_using_neighbors(self):
        graph = main.build_sample_cluster()
        expected = [
            ("Deployment/checkout-api", "OWNS", "ReplicaSet/checkout-api-abc"),
            ("Service/checkout-api", "EXPOSES", "Deployment/checkout-api"),
            (
                "Deployment/checkout-api",
                "OBSERVED_BY",
                "Prom/error_rate{deployment=checkout-api}",
            ),
            (
                "Deployment/checkout-api",
                "OBSERVED_BY",
                "Loki/namespace=prod,app=checkout-api",
            ),
        ]
        for index in range(3):
            pod = f"Pod/checkout-api-abc-{index}"
            expected.append(("ReplicaSet/checkout-api-abc", "OWNS", pod))
            expected.append((pod, "SCHEDULED_ON", "Node/ip-10-2-3-4"))

        self.assertEqual(Counter(graph.edges), Counter(expected))


class TestGraphNeighbors(unittest.TestCase):
    def test_returns_outgoing_then_incoming_neighbors(self):
        graph = main.Graph()
        graph.link("Deployment/api", "OWNS", "ReplicaSet/api-v1")
        graph.link("Service/api", "EXPOSES", "Deployment/api")
        graph.link("Deployment/api", "OBSERVED_BY", "Prom/api-errors")
        graph.link("Pod/unrelated", "SCHEDULED_ON", "Node/other")

        self.assertEqual(
            graph.neighbors("Deployment/api"),
            [
                ("OWNS", "ReplicaSet/api-v1"),
                ("OBSERVED_BY", "Prom/api-errors"),
                ("EXPOSES", "Service/api"),
            ],
        )

    def test_preserves_parallel_edges_and_handles_missing_key(self):
        graph = main.Graph()
        graph.link("Pod/a", "SCHEDULED_ON", "Node/n1")
        graph.link("Pod/a", "SCHEDULED_ON", "Node/n1")

        self.assertEqual(
            graph.neighbors("Pod/a"),
            [("SCHEDULED_ON", "Node/n1"), ("SCHEDULED_ON", "Node/n1")],
        )
        self.assertEqual(graph.neighbors("Deployment/missing"), [])


class TestAgentCall(unittest.TestCase):
    def test_read_only_tools_execute_and_are_audited(self):
        agent = main.Agent(main.Graph())
        with mock.patch.object(main.time, "time", return_value=1234.5):
            for tool in agent.read_only_tools:
                args = {"request": tool}
                event = agent.call(tool, args)
                self.assertEqual(event.ts, 1234.5)
                self.assertEqual(event.tool, tool)
                self.assertEqual(event.args, args)
                self.assertTrue(event.considered)
                self.assertTrue(event.executed)
                self.assertFalse(event.approved)
                self.assertIsNone(event.approver)
                self.assertEqual(event.result, "ok (read-only)")

        self.assertEqual(agent.audit, agent.audit[-len(agent.read_only_tools):])
        self.assertEqual([event.tool for event in agent.audit], list(agent.read_only_tools))

    def test_destructive_tool_requires_approval(self):
        agent = main.Agent(main.Graph())
        args = {"app": "checkout-api", "to_revision": 41}

        blocked = agent.call("argocd_rollback", args)
        self.assertTrue(blocked.considered)
        self.assertFalse(blocked.approved)
        self.assertFalse(blocked.executed)
        self.assertIsNone(blocked.approver)
        self.assertEqual(blocked.result, "blocked: no slack approval")

        allowed = agent.call("argocd_rollback", args, approver="alice@sre")
        self.assertTrue(allowed.considered)
        self.assertTrue(allowed.approved)
        self.assertTrue(allowed.executed)
        self.assertEqual(allowed.approver, "alice@sre")
        self.assertEqual(allowed.result, "executed by alice@sre")
        self.assertEqual(agent.audit, [blocked, allowed])

    def test_unknown_tool_is_blocked_even_with_approver(self):
        agent = main.Agent(main.Graph())
        event = agent.call("shell_exec", {"command": "unsafe"}, approver="alice@sre")

        self.assertTrue(event.considered)
        self.assertFalse(event.approved)
        self.assertFalse(event.executed)
        self.assertIsNone(event.approver)
        self.assertEqual(event.result, "blocked: unknown tool")
        self.assertIs(agent.audit[0], event)


class TestRootCause(unittest.TestCase):
    def test_builds_rollout_hypothesis_from_adjacent_telemetry(self):
        graph = main.Graph()
        deployment = main.Node(
            "Deployment",
            "api",
            {"image": "api:v7", "deployed_at": "12m ago"},
        )
        prom = main.Node("Prom", "api-error-rate")
        loki = main.Node("Loki", "api-stacktraces")
        tempo = main.Node("Tempo", "api-traces")
        pod = main.Node("Pod", "api-1")
        for node in (deployment, prom, loki, tempo, pod):
            graph.add(node)

        def neighbors(key):
            self.assertEqual(key, deployment.key)
            return [
                ("OBSERVED_BY", prom.key),
                ("OBSERVED_BY", loki.key),
                ("OBSERVED_BY", tempo.key),
                ("OWNS", pod.key),
            ]

        graph.neighbors = neighbors

        def fake_score(hypothesis):
            return 0.9 if hypothesis.title.startswith("bad rollout:") else 0.1

        with mock.patch.object(main.Hypothesis, "score", fake_score):
            hypotheses = main.root_cause(graph, deployment.key)

        self.assertEqual(len(hypotheses), 2)
        rollout = hypotheses[0]
        self.assertEqual(rollout.title, "bad rollout: image api:v7 fails /healthz")
        self.assertEqual(
            rollout.citations,
            ["api-error-rate", "api-stacktraces", "api-traces"],
        )
        self.assertEqual(rollout.recency_mins, 12)
        self.assertEqual(rollout.specificity, 0.82)
        self.assertEqual(rollout.path_len, 0)
        self.assertEqual(hypotheses[1].title, "DNS flap in kube-system/coredns")

    def test_builds_node_pressure_hypothesis_for_direct_node_neighbor(self):
        graph = main.Graph()
        pod = main.Node("Pod", "api-1")
        node = main.Node("Node", "worker-7", {"kernel": "6.8.1"})
        graph.add(pod)
        graph.add(node)
        graph.neighbors = lambda key: [("SCHEDULED_ON", node.key)]

        def fake_score(hypothesis):
            return 0.8 if hypothesis.title.startswith("node-level pressure") else 0.1

        with mock.patch.object(main.Hypothesis, "score", fake_score):
            hypotheses = main.root_cause(graph, pod.key)

        self.assertEqual(len(hypotheses), 2)
        pressure = hypotheses[0]
        self.assertEqual(
            pressure.title,
            "node-level pressure on worker-7 (kernel=6.8.1)",
        )
        self.assertEqual(pressure.citations, ["worker-7"])
        self.assertEqual(pressure.recency_mins, 30)
        self.assertEqual(pressure.specificity, 0.45)
        self.assertEqual(pressure.path_len, 2)

    def test_missing_alerted_object_returns_only_fallback(self):
        graph = main.Graph()
        graph.neighbors = lambda key: []
        with mock.patch.object(main.Hypothesis, "score", return_value=0.25):
            hypotheses = main.root_cause(graph, "Deployment/missing")

        self.assertEqual(len(hypotheses), 1)
        fallback = hypotheses[0]
        self.assertEqual(fallback.title, "DNS flap in kube-system/coredns")
        self.assertEqual(fallback.citations, [])
        self.assertEqual(fallback.recency_mins, 60)
        self.assertEqual(fallback.specificity, 0.2)
        self.assertEqual(fallback.path_len, 4)


class TestHypothesisScore(unittest.TestCase):
    def test_combines_all_scoring_components(self):
        hypothesis = main.Hypothesis(
            title="specific recent cause",
            citations=["c1", "c2", "c3", "c4", "c5"],
            recency_mins=0,
            specificity=1.0,
            path_len=0,
        )
        self.assertAlmostEqual(hypothesis.score(), 1.0, places=12)

    def test_recency_floor_citation_cap_and_path_weight(self):
        capped = main.Hypothesis(
            title="capped",
            citations=[str(index) for index in range(10)],
            recency_mins=120,
            specificity=0.0,
            path_len=3,
        )
        five_citations = main.Hypothesis(
            title="five",
            citations=[str(index) for index in range(5)],
            recency_mins=60,
            specificity=0.0,
            path_len=3,
        )
        expected = 0.2 + 0.1 * (1.0 / 4.0)
        self.assertAlmostEqual(capped.score(), expected, places=12)
        self.assertAlmostEqual(five_citations.score(), expected, places=12)

    def test_score_is_monotonic_for_better_evidence(self):
        weak = main.Hypothesis("weak", [], 50, 0.2, 4)
        strong = main.Hypothesis("strong", ["metric", "log"], 5, 0.8, 1)
        self.assertGreater(strong.score(), weak.score())


if __name__ == "__main__":
    unittest.main()
