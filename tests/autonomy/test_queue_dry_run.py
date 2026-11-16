"""Unit tests for staged queue routing; no credentials or network."""
import importlib.util
import contextlib
import io
import json
import pathlib
import unittest
from unittest import mock

module_path = pathlib.Path(__file__).resolve().parents[2] / "scripts/autonomy/queue_dry_run.py"
spec = importlib.util.spec_from_file_location("skycar_queue", module_path)
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

class RoutingTests(unittest.TestCase):
    def test_every_role_has_a_route(self):
        self.assertEqual(set(queue.ROUTES.values()), set(queue.ROLES))
    def test_all_nine_stages_route(self):
        for label, role in queue.ROUTES.items():
            with self.subTest(label=label):
                result = queue.plan({"number": 1, "labels": ["agent-approved", label]})
                self.assertEqual(result["decision"], "DRY_RUN_ONLY")
                self.assertEqual(result["agent"], role)
    def test_protected_work_is_blocked(self):
        for label in queue.BLOCKED:
            with self.subTest(label=label):
                self.assertEqual(queue.plan({"labels": ["agent-approved", "backend-ready", label]})["decision"], "BLOCK")
    def test_unapproved_issue_skipped(self):
        self.assertEqual(queue.plan({"labels": ["mobile-ready"]})["decision"], "SKIP")
    def test_ambiguous_or_missing_stage_blocked(self):
        for labels in (["agent-approved"], ["agent-approved", "mobile-ready", "backend-ready"]):
            self.assertEqual(queue.plan({"labels": labels})["decision"], "BLOCK")

INVALID_ISSUES = (None, True, 1, 1.5, "issue", [], ["labels"])
INVALID_LABELS = (
    "agent-approved", "", None, {}, {"agent-approved": True},
    True, 1, 1.5, ("agent-approved",), {"agent-approved"},
    [["agent-approved"]], ["agent-approved", None],
    ["agent-approved", 1], ["agent-approved", True],
    ["agent-approved", {}], ["agent-approved", []],
    ["agent-approved", "backend-ready", 1], ["production", None],
)

class InputValidationTests(unittest.TestCase):
    def test_non_object_issues_rejected(self):
        for issue in INVALID_ISSUES:
            with self.subTest(issue=issue):
                with self.assertRaisesRegex(ValueError, "issue must be a JSON object"):
                    queue.plan(issue)

    def test_invalid_labels_rejected(self):
        for labels in INVALID_LABELS:
            with self.subTest(labels=labels):
                with self.assertRaisesRegex(ValueError, "labels must be a list of strings"):
                    queue.plan({"labels": labels})

    def test_missing_and_empty_labels_still_skipped(self):
        for issue in ({}, {"labels": []}):
            with self.subTest(issue=issue):
                self.assertEqual(queue.plan(issue), {
                    "issue": None, "decision": "SKIP",
                    "reason": "not approved for agent queue",
                })

    def test_duplicate_and_unknown_labels_preserve_routing(self):
        self.assertEqual(queue.plan({"number": 42, "labels": [
            "agent-approved", "backend-ready", "backend-ready", "unknown", "",
        ]}), {
            "issue": 42, "decision": "DRY_RUN_ONLY", "agent": "backend",
            "reason": "staged; no executor connected",
        })

class CliTests(unittest.TestCase):
    def run_cli(self, source):
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch("sys.argv", ["queue_dry_run.py", "issues.json"]), \
                mock.patch.object(pathlib.Path, "read_text", return_value=source), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                queue.main()
            except SystemExit as exc:
                code = exc.code
            else:
                code = 0
        return code, stdout.getvalue(), stderr.getvalue()

    def assert_cli_error(self, source, message):
        code, stdout, stderr = self.run_cli(source)
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("usage:", stderr)
        self.assertIn("queue_dry_run.py: error: " + message, stderr)
        self.assertNotIn("Traceback", stderr)
        self.assertLessEqual(len(stderr.splitlines()), 3)

    def test_malformed_json(self):
        for source in ("", "[", '[{"labels": []},]', '{"labels": }'):
            with self.subTest(source=source):
                self.assert_cli_error(source, "Malformed JSON:")

    def test_non_list_input(self):
        for value in ({}, None, True, 1, 1.5, "issues"):
            with self.subTest(value=value):
                self.assert_cli_error(json.dumps(value), "Expected JSON list of issue snapshots")

    def test_non_object_entries(self):
        for issue in INVALID_ISSUES:
            with self.subTest(issue=issue):
                self.assert_cli_error(json.dumps([{}, issue]),
                                      "Invalid issue: issue must be a JSON object")

    def test_invalid_label_entries(self):
        for labels in INVALID_LABELS:
            if isinstance(labels, (tuple, set)):
                continue  # These Python types cannot occur in parsed JSON.
            with self.subTest(labels=labels):
                self.assert_cli_error(json.dumps([{}, {"labels": labels}]),
                                      "Invalid issue: labels must be a list of strings")

    def test_valid_input(self):
        issues = [{"number": n, "labels": ["agent-approved", stage]}
                  for n, stage in enumerate(queue.ROUTES)]
        for data in ([], issues):
            with self.subTest(data=data):
                code, stdout, stderr = self.run_cli(json.dumps(data))
                self.assertEqual(code, 0)
                self.assertEqual(stderr, "")
                self.assertEqual(json.loads(stdout), {
                    "mode": "dry-run", "roles": list(queue.ROLES),
                    "tasks": [{"issue": n, "decision": "DRY_RUN_ONLY", "agent": role,
                               "reason": "staged; no executor connected"}
                              for n, role in enumerate(queue.ROUTES.values())] if data else [],
                })

if __name__ == "__main__":
    unittest.main()
