"""Unit tests for staged queue routing; no credentials or network."""
import importlib.util
import pathlib
import unittest

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

if __name__ == "__main__":
    unittest.main()
