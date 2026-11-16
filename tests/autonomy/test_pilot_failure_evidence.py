"""Failure evidence against the pinned SDK, with no real key or network."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    from openai import OpenAI
    import httpx2
except ImportError:
    OpenAI = None

spec = importlib.util.spec_from_file_location(
    "evidence_pilot", Path(__file__).resolve().parents[2] / "scripts/autonomy/bounded_coding_pilot.py")
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)

PRIVATE = "sk-proj-FAKE-CREDENTIAL-MUST-NOT-BE-LOGGED"


@unittest.skipIf(OpenAI is None, "Install the pinned SDK for mocked HTTP tests")
class FailureEvidenceTests(unittest.TestCase):
    def request(self):
        return pilot.build_request({p: b"# source\n" for p in pilot.ALLOWED_FILES}, "a" * 40, 100)

    def run_failure(self, status=403, fail_at="create", request_id="req_failure123",
                    cleanup_status=None, code="permission_denied"):
        requests = []
        session = {"id": "sess_evidence", "object": "agent.session", "created_at": 0,
                   "last_active_at": 0, "agent": {"model": pilot.MODEL},
                   "environment": {"type": "openai_hosted", "id": "env_evidence"},
                   "metadata": {}, "required_actions": [], "status": "idle", "vault_ids": [],
                   "spend_control": {"limit": 100, "consumed": 0}}

        def error(n, rid):
            return httpx2.Response(n, headers={"x-request-id": rid},
                                   json={"error": {"message": PRIVATE, "type": PRIVATE, "code": code}})

        def handle(req):
            requests.append((req.method, req.url.path))
            if req.method == "DELETE":
                if cleanup_status:
                    return error(cleanup_status, "req_delete123")
                return httpx2.Response(200, json={"id": session["id"],
                    "object": "agent.session.deleted", "deleted": True})
            if req.url.path.endswith("/events"):
                return httpx2.Response(200, json={})
            if (fail_at == "create" and req.method == "POST") or (
                    fail_at == "readiness" and req.method == "GET"):
                return error(status, request_id)
            return httpx2.Response(200, headers={"x-request-id": "req_create123"}, json=session)

        request = self.request()
        with OpenAI(api_key="offline-contract-test", max_retries=0,
                    http_client=httpx2.Client(transport=httpx2.MockTransport(handle))) as client:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "evidence"
                stdout, stderr = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    with self.assertRaises(Exception):
                        pilot.execute(client, request, out, pilot.fingerprint(request))
                raw = (out / "state.json").read_text()
                self.assertNotIn(PRIVATE, raw + stdout.getvalue() + stderr.getvalue())
                self.assertNotIn("Authorization", raw)
                self.assertFalse((out / "changes.json").exists())
                state = json.loads(raw)
        self.assertEqual(sum(m == "POST" and p.endswith("/sessions") for m, p in requests), 1)
        if fail_at == "create":
            self.assertFalse(any(m == "POST" and p.endswith("/events") for m, p in requests))
        return state, requests

    def test_http_failures_keep_status_request_id_sdk_and_utc_timing(self):
        for status in (400, 401, 403, 404, 422, 429, 500):
            with self.subTest(status=status):
                state, _ = self.run_failure(status)
                failure = state["failure"]
                self.assertEqual(failure["http_status"], status)
                self.assertEqual(failure["request_id"], "req_failure123")
                self.assertEqual(failure["stage"], "session_create")
                self.assertEqual(failure["sdk_version"], "3.49.0")
                self.assertEqual(failure["error_code"], "permission_denied")
                self.assertIn("+00:00", failure["at_utc"])
                self.assertIn("+00:00", state["started_at_utc"])
                self.assertIn("+00:00", state["finished_at_utc"])
                self.assertIsNone(state["session_id"])
                self.assertEqual(state["cleanup"], "creation_outcome_unknown_do_not_retry")

    def test_default_client_starts_with_a_socks_proxy_without_a_request(self):
        # Constructor only: the proxy is never contacted, and no key leaves the process.
        proxy_env = {"ALL_PROXY": "socks5://127.0.0.1:9", "HTTPS_PROXY": "socks5://127.0.0.1:9",
                     "HTTP_PROXY": "socks5://127.0.0.1:9", "NO_PROXY": ""}
        with patch.dict(os.environ, proxy_env, clear=True):
            with OpenAI(api_key="offline-constructor-test", max_retries=0) as client:
                self.assertEqual(client.max_retries, 0)

    def test_session_and_creation_id_survive_later_readiness_failure(self):
        state, _ = self.run_failure(fail_at="readiness")
        self.assertEqual(state["session_id"], "sess_evidence")
        self.assertEqual(state["create_request_id"], "req_create123")
        self.assertEqual(state["failure"]["stage"], "session_readiness")
        self.assertEqual(state["failure"]["request_id"], "req_failure123")
        self.assertEqual(state["cleanup"], "deletion_requested")

    def test_cleanup_error_does_not_overwrite_original_failure(self):
        state, _ = self.run_failure(status=429, fail_at="readiness", cleanup_status=403)
        self.assertEqual(state["failure"]["http_status"], 429)
        self.assertEqual(state["cleanup_failure"]["http_status"], 403)
        self.assertEqual(state["cleanup_failure"]["request_id"], "req_delete123")
        self.assertEqual(state["cleanup"], "pending_manual_reconciliation")

    def test_arbitrary_error_codes_and_header_values_are_not_logged(self):
        state, _ = self.run_failure(request_id=PRIVATE, code=PRIVATE)
        self.assertIsNone(state["failure"]["request_id"])
        self.assertIsNone(state["failure"]["error_code"])

    def test_connection_and_timeout_have_no_fabricated_http_evidence(self):
        from openai import APIConnectionError, APITimeoutError
        req = httpx2.Request("POST", "https://api.openai.com/v1/agents/sessions")
        for exc, category in ((APIConnectionError(message=PRIVATE, request=req),
                               "connection_outcome_unknown"),
                              (APITimeoutError(request=req), "timeout_outcome_unknown")):
            details = pilot.failure_details(exc, "session_create")
            self.assertEqual(details["category"], category)
            self.assertIsNone(details["http_status"])
            self.assertIsNone(details["request_id"])
            self.assertNotIn(PRIVATE, json.dumps(details))

    def test_cli_error_output_is_redacted_and_actionable(self):
        from openai import PermissionDeniedError
        req = httpx2.Request("POST", "https://api.openai.com/v1/agents/sessions")
        response = httpx2.Response(403, request=req, headers={"x-request-id": "req_cli123"})
        error = PermissionDeniedError(PRIVATE, response=response, body={"code": PRIVATE})
        stderr = io.StringIO()
        with patch.object(sys, "argv", ["pilot", "--sha", "a" * 40]), \
                patch.object(pilot, "source_snapshot", side_effect=error), \
                contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit):
            pilot.main()
        raw = stderr.getvalue()
        self.assertNotIn(PRIVATE, raw)
        self.assertEqual(json.loads(raw)["failure"]["http_status"], 403)
        self.assertEqual(json.loads(raw)["failure"]["request_id"], "req_cli123")


if __name__ == "__main__":
    unittest.main()
