"""Fixed operator checks for the generated project-budget implementation."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "operator_pilot", Path(__file__).resolve().parents[2] / "scripts/autonomy/bounded_coding_pilot.py")
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
PROJECT = "proj_6X0oPYbwi6a70uC4NP5AXiso"


class Context:
    def __init__(self, value): self.value = value
    def __enter__(self): return self.value
    def __exit__(self, *args): return False


def fake_client():
    sessions = Mock()
    sessions.create.return_value = NS(id="sess_operator", spend_control=None)
    sessions.retrieve.return_value = NS(status="idle", environment=NS(id="env_operator"))
    stream = Mock()
    stream.get_final_result.return_value = NS(session_id="sess_operator", turn_id="turn_operator")
    sessions.stream.return_value = Context(stream)
    sessions.artifacts.list.return_value = [NS(id="art_operator", turn_id="turn_operator",
                                              path="/workspace/outputs/changes.json")]
    raw = json.dumps({"task_id": pilot.TASK_ID, "files": [
        {"path": path, "content": "# candidate\n"} for path in pilot.ALLOWED_FILES]}).encode()
    sessions.artifacts.with_streaming_response.content.return_value = Context(
        NS(iter_bytes=lambda: iter([raw])))
    environments = NS(retrieve=Mock(return_value=NS(status="connected")))
    return NS(project=PROJECT, beta=NS(agents=NS(sessions=sessions, environments=environments))), sessions


class OperatorProjectBudgetChecks(unittest.TestCase):
    def request(self, cents=500):
        return pilot.build_request({p: b"# approved source\n" for p in pilot.ALLOWED_FILES}, "a" * 40, cents)

    def receipt(self, **changes):
        value = {"mode": "operator_verified_project_hard_limit", "project_id": PROJECT,
                 "sha": "a" * 40, "task": pilot.TASK_ID, "hard_limit_enforced": True,
                 "limit_cents": 500, "observed_spend_cents": 0,
                 "verified_at_utc": datetime.now(timezone.utc).isoformat()}
        value.update(changes)
        return value

    def test_five_dollar_bound_is_explicit(self):
        self.assertEqual(pilot.MAX_CENTS, 500)
        self.request(500)
        for bad in (0, -1, 501, True, 2.5):
            with self.subTest(bad=bad), self.assertRaises(pilot.PilotError):
                self.request(bad)

    def test_valid_receipt_is_not_mutated(self):
        request, receipt = self.request(), self.receipt()
        original = copy.deepcopy(receipt)
        checked = pilot.validate_project_budget(receipt, request, expected_project_id=PROJECT)
        self.assertEqual(receipt, original)
        self.assertEqual(checked["project_id"], PROJECT)
        self.assertIsNot(checked, receipt)

    def test_bad_receipts_are_rejected(self):
        now = datetime.now(timezone.utc)
        changes = [
            {"mode": "automatic"}, {"project_id": "proj_wrong"}, {"sha": "b" * 40},
            {"task": "different"}, {"hard_limit_enforced": False}, {"hard_limit_enforced": 1},
            {"limit_cents": 501}, {"limit_cents": True}, {"observed_spend_cents": 500},
            {"observed_spend_cents": -1}, {"observed_spend_cents": True},
            {"verified_at_utc": (now - timedelta(seconds=301)).isoformat()},
            {"verified_at_utc": (now + timedelta(minutes=1)).isoformat()},
            {"verified_at_utc": "2026-11-16T00:00:00"}, {"verified_at_utc": "invalid"},
            {"surprise": "not allowed"},
        ]
        for change in changes:
            receipt = self.receipt(verified_at_utc=now.isoformat())
            receipt.update(change)
            with self.subTest(change=change), self.assertRaises(pilot.PilotError):
                pilot.validate_project_budget(receipt, self.request(),
                                              expected_project_id=PROJECT, now=now)
        with self.assertRaises(pilot.PilotError):
            pilot.validate_project_budget(self.receipt(), self.request(100), expected_project_id=PROJECT)

    def test_explicit_project_mode_omits_rejected_field_and_preserves_request(self):
        client, sessions = fake_client()
        request, receipt = self.request(), self.receipt()
        original = copy.deepcopy(request)
        with tempfile.TemporaryDirectory() as temp:
            state = pilot.execute(client, request, Path(temp) / "output",
                                  pilot.fingerprint(request, project_budget=receipt),
                                  project_budget=receipt)
        self.assertNotIn("spend_control", sessions.create.call_args.kwargs)
        self.assertEqual(request, original)
        self.assertEqual(state["budget_mode"], "operator_verified_project_hard_limit")
        self.assertEqual(state["cleanup"], "deletion_requested")
        self.assertIsNone(sessions.create.return_value.spend_control)

    def test_project_mismatch_never_creates_a_session(self):
        client, sessions = fake_client()
        client.project = "proj_different"
        request, receipt = self.request(), self.receipt()
        with tempfile.TemporaryDirectory() as temp, self.assertRaises(pilot.PilotError):
            pilot.execute(client, request, Path(temp) / "output",
                          pilot.fingerprint(request, project_budget=receipt), project_budget=receipt)
        sessions.create.assert_not_called()

    def test_confirmation_changes_bind_the_fingerprint(self):
        request, receipt = self.request(), self.receipt()
        plain = pilot.fingerprint(request)
        project = pilot.fingerprint(request, project_budget=receipt)
        self.assertNotEqual(plain, project)
        changed = dict(receipt, observed_spend_cents=1)
        self.assertNotEqual(project, pilot.fingerprint(request, project_budget=changed))

    def test_expiration_during_setup_prevents_coding_and_cleans_up(self):
        client, sessions = fake_client()
        request, receipt = self.request(), self.receipt()
        token = pilot.fingerprint(request, project_budget=receipt)
        validate = pilot.validate_project_budget
        calls = 0
        def revalidate(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls >= 2:
                raise pilot.PilotError("Confirmation expired")
            return validate(*args, **kwargs)
        with tempfile.TemporaryDirectory() as temp, \
                patch.object(pilot, "validate_project_budget", side_effect=revalidate), \
                self.assertRaises(pilot.PilotError):
            pilot.execute(client, request, Path(temp) / "output", token, project_budget=receipt)
        sessions.stream.assert_not_called()
        if sessions.create.called:
            sessions.delete.assert_called_once()

    def test_confirmation_file_must_be_private_external_and_regular(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            checkout = parent / "checkout"
            checkout.mkdir()
            receipt = parent / "operator-confirmation.json"
            receipt.write_text(json.dumps(self.receipt()))
            receipt.chmod(0o600)
            self.assertEqual(pilot.load_project_budget(receipt, checkout)["project_id"], PROJECT)
            receipt.chmod(0o644)
            with self.assertRaises(pilot.PilotError): pilot.load_project_budget(receipt, checkout)
            receipt.chmod(0o600)
            link = parent / "link.json"
            link.symlink_to(receipt)
            with self.assertRaises(pilot.PilotError): pilot.load_project_budget(link, checkout)
            inside = checkout / "untrusted.json"
            inside.write_text(receipt.read_text())
            inside.chmod(0o600)
            with self.assertRaises(pilot.PilotError): pilot.load_project_budget(inside, checkout)
            receipt.write_text('{"mode":"one","mode":"two"}')
            with self.assertRaises(pilot.PilotError): pilot.load_project_budget(receipt, checkout)


if __name__ == "__main__":
    unittest.main()
