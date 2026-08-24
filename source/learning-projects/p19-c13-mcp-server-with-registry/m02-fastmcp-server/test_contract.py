import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import main


class TestMCPServerRegister(unittest.TestCase):
    def test_register_indexes_and_replaces_schema_and_handler(self):
        server = main.MCPServer(name="test", url="https://example.test/mcp")
        first_schema = main.ToolSchema(
            "jira.search", "jira:read", False, "Search Jira", {"type": "object"}
        )
        first_handler = Mock()

        server.register(first_schema, first_handler)

        self.assertIs(server.tools["jira.search"], first_schema)
        self.assertIs(server.handlers["jira.search"], first_handler)

        replacement_schema = main.ToolSchema(
            "jira.search", "jira:read:v2", False, "Replacement", {"type": "object"}
        )
        replacement_handler = Mock()
        server.register(replacement_schema, replacement_handler)

        self.assertEqual(set(server.tools), {"jira.search"})
        self.assertEqual(set(server.handlers), {"jira.search"})
        self.assertIs(server.tools["jira.search"], replacement_schema)
        self.assertIs(server.handlers["jira.search"], replacement_handler)


class TestDispatch(unittest.TestCase):
    def test_denial_success_and_handler_error_have_distinct_outcomes(self):
        server = main.MCPServer(name="test", url="https://example.test/mcp")
        blocked_handler = Mock()
        success_handler = Mock(return_value={"value": "raw"})
        failure_handler = Mock(side_effect=ValueError("boom"))
        server.handlers.update({
            "blocked": blocked_handler,
            "success": success_handler,
            "failure": failure_handler,
        })
        token = main.Token(user="user-7", scopes=set())
        audit = []

        with patch("main.time.time", return_value=100.0), patch(
            "main.policy_decide", return_value=(False, "scope denied")
        ), patch("main.redact", side_effect=lambda value: {"clean": value}):
            denied = main.dispatch(server, token, "blocked", {"x": 1}, audit)

        self.assertEqual(denied, {"error": {"code": 403, "message": "scope denied"}})
        blocked_handler.assert_not_called()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[-1].ts, 100.0)
        self.assertEqual(audit[-1].user, "user-7")
        self.assertEqual(audit[-1].tool, "blocked")
        self.assertEqual(audit[-1].outcome, "denied:scope denied")
        self.assertEqual(audit[-1].args_redacted, {"clean": {"x": 1}})
        self.assertEqual(audit[-1].response_redacted, {})

        with patch("main.time.time", return_value=200.0), patch(
            "main.policy_decide", return_value=(True, "ok")
        ), patch("main.redact", side_effect=lambda value: {"clean": value}):
            succeeded = main.dispatch(server, token, "success", {"x": 2}, audit)

        self.assertEqual(succeeded, {"result": {"value": "raw"}})
        success_handler.assert_called_once_with({"x": 2})
        self.assertEqual(audit[-1].outcome, "ok")
        self.assertEqual(audit[-1].args_redacted, {"clean": {"x": 2}})
        self.assertEqual(audit[-1].response_redacted, {"clean": {"value": "raw"}})

        with patch("main.time.time", return_value=300.0), patch(
            "main.policy_decide", return_value=(True, "ok")
        ), patch("main.redact", side_effect=lambda value: {"clean": value}):
            failed = main.dispatch(server, token, "failure", {"x": 3}, audit)

        self.assertEqual(failed, {"error": {"code": 500, "message": "boom"}})
        failure_handler.assert_called_once_with({"x": 3})
        self.assertEqual(audit[-1].outcome, "error:boom")
        self.assertEqual(audit[-1].args_redacted, {"clean": {"x": 3}})
        self.assertEqual(audit[-1].response_redacted, {})


class TestPolicyDecide(unittest.TestCase):
    def test_unknown_and_unauthorized_tools_are_rejected_before_later_checks(self):
        token = Mock()
        empty_server = SimpleNamespace(tools={})

        decision = main.policy_decide(empty_server, "missing", token, {}, 50.0)

        self.assertEqual(decision, (False, "no such tool: missing"))
        token.has_scope.assert_not_called()
        token.fresh_approval.assert_not_called()

        schema = SimpleNamespace(required_scope="jira:read", destructive=False)
        server = SimpleNamespace(tools={"jira.search": schema})
        token.has_scope.return_value = False

        decision = main.policy_decide(server, "jira.search", token, {}, 50.0)

        self.assertEqual(decision, (False, "missing scope: jira:read"))
        token.has_scope.assert_called_once_with("jira:read")
        token.fresh_approval.assert_not_called()

    def test_destructive_approval_and_payload_limit_are_enforced(self):
        safe = SimpleNamespace(required_scope="read", destructive=False)
        destructive = SimpleNamespace(required_scope="write", destructive=True)
        server = SimpleNamespace(tools={"safe": safe, "danger": destructive})
        token = Mock()
        token.has_scope.return_value = True
        token.fresh_approval.return_value = False

        denied = main.policy_decide(server, "danger", token, {}, 100.0)

        self.assertEqual(
            denied,
            (False, "destructive tool requires fresh human approval (Slack card)"),
        )
        token.fresh_approval.assert_called_once_with(100.0)

        exactly_at_limit = {"x": "a" * 8183}
        self.assertEqual(len(json.dumps(exactly_at_limit)), 8192)
        self.assertEqual(
            main.policy_decide(server, "safe", token, exactly_at_limit, 100.0),
            (True, "ok"),
        )

        over_limit = {"x": "a" * 8184}
        self.assertEqual(len(json.dumps(over_limit)), 8193)
        self.assertEqual(
            main.policy_decide(server, "safe", token, over_limit, 100.0),
            (False, "payload too large (> 8 KB)"),
        )


class TestRegistryRegister(unittest.TestCase):
    def test_register_polls_capabilities_and_replaces_same_named_entry(self):
        registry = main.Registry()
        first_manifest = {"server": "alpha", "tools": []}
        first = SimpleNamespace(
            name="alpha", capabilities=Mock(return_value=first_manifest)
        )

        registry.register(first)

        first.capabilities.assert_called_once_with()
        self.assertIs(registry.entries["alpha"], first_manifest)

        replacement_manifest = {"server": "alpha", "tools": [{"name": "new"}]}
        replacement = SimpleNamespace(
            name="alpha", capabilities=Mock(return_value=replacement_manifest)
        )
        registry.register(replacement)

        replacement.capabilities.assert_called_once_with()
        self.assertEqual(set(registry.entries), {"alpha"})
        self.assertIs(registry.entries["alpha"], replacement_manifest)


class TestRegistrySearch(unittest.TestCase):
    def test_search_is_case_insensitive_and_matches_name_or_description(self):
        registry = main.Registry(entries={
            "alpha": {
                "tools": [
                    {"name": "jira.search", "description": "Find tickets"},
                    {"name": "sql.query", "description": "Read-only PostgreSQL access"},
                ]
            },
            "beta": {
                "tools": [
                    {"name": "confluence.find", "description": "Jira backlog mirror"},
                    {"name": "slack.history", "description": "Read channels"},
                ]
            },
        })

        self.assertEqual(
            registry.search("JiRa"),
            [("alpha", "jira.search"), ("beta", "confluence.find")],
        )
        self.assertEqual(registry.search("POSTGRES"), [("alpha", "sql.query")])
        self.assertEqual(registry.search("not-present"), [])


class TestMCPServerCapabilities(unittest.TestCase):
    def test_capabilities_describe_transport_and_registered_tools_in_order(self):
        server = main.MCPServer(name="catalog", url="https://example.test/catalog")
        first_schema = {"type": "object", "properties": {"q": {"type": "string"}}}
        second_schema = {"type": "object", "properties": {"id": {"type": "integer"}}}
        server.tools["search"] = main.ToolSchema(
            "search", "catalog:read", False, "Search catalog", first_schema
        )
        server.tools["delete"] = main.ToolSchema(
            "delete", "catalog:write", True, "Delete item", second_schema
        )

        capabilities = server.capabilities()

        self.assertEqual(capabilities, {
            "server": "catalog",
            "transport": "streamable_http",
            "url": "https://example.test/catalog",
            "tools": [
                {
                    "name": "search",
                    "scope": "catalog:read",
                    "destructive": False,
                    "description": "Search catalog",
                    "input_schema": first_schema,
                },
                {
                    "name": "delete",
                    "scope": "catalog:write",
                    "destructive": True,
                    "description": "Delete item",
                    "input_schema": second_schema,
                },
            ],
        })


class TestTokenFreshApproval(unittest.TestCase):
    def test_approval_requires_scope_and_honors_inclusive_freshness_boundary(self):
        now = 10000.0
        without_scope = main.Token(
            user="u", scopes={"jira:write"}, approved_at=now
        )
        self.assertFalse(without_scope.fresh_approval(now))

        token = main.Token(
            user="u", scopes={"jira:write", "approved:by:human"}, approved_at=9100.0
        )
        self.assertTrue(token.fresh_approval(now))

        token.approved_at = 9099.999
        self.assertFalse(token.fresh_approval(now))

        token.approved_at = 9970.0
        self.assertTrue(token.fresh_approval(now, window_s=30))
        token.approved_at = 9969.999
        self.assertFalse(token.fresh_approval(now, window_s=30))


class TestRedact(unittest.TestCase):
    def test_redact_recurses_through_json_without_mutating_input(self):
        payload = {
            "email": "alice+tag@example.com",
            "nested": {
                "ssn": "123-45-6789",
                "phone": "+1 415-555-0199",
            },
            "items": ["owner bob.smith@corp.co"],
            "count": 3,
        }
        original = {
            "email": "alice+tag@example.com",
            "nested": {
                "ssn": "123-45-6789",
                "phone": "+1 415-555-0199",
            },
            "items": ["owner bob.smith@corp.co"],
            "count": 3,
        }

        redacted = main.redact(payload)

        self.assertEqual(payload, original)
        self.assertEqual(redacted, {
            "email": "[email]",
            "nested": {
                "ssn": "[ssn]",
                "phone": "+1 415-555-0199",
            },
            "items": ["owner [email]"],
            "count": 3,
        })
        self.assertIsNot(redacted, payload)
        self.assertIsNot(redacted["nested"], payload["nested"])
