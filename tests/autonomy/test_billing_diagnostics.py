"""Billing rejection reasons and a protected diagnostic without paid-session access."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts/autonomy'))
from bounded_coding_pilot import PilotError
from executor_billing import validate_proof
from executor_diagnostics import diagnostic_gate, safe_failure
from executor_pipeline import verify_billing_only


def valid_proof(**changes):
    return dict(project_id='proj_test', currency='USD', interval='month',
                limit_cents=500, enforcement='inactive', observed_spend_cents=187,
                verified_at_utc=datetime.now(timezone.utc).isoformat(), **changes)


class BillingDiagnosticsTests(unittest.TestCase):
    def test_every_rejection_reports_only_a_fixed_reason(self):
        cases = [('schema', {'extra': 'DO-NOT-LOG'}), ('project', {'project_id': 'DO-NOT-LOG'}),
                 ('currency', {'currency': 'DO-NOT-LOG'}), ('interval', {'interval': 'day'}),
                 ('enforcement', {'enforcement': 'enforcing'}), ('limit_type', {'limit_cents': True}),
                 ('limit_range', {'limit_cents': 501}), ('spend_type', {'observed_spend_cents': True}),
                 ('spend_range', {'observed_spend_cents': 500}),
                 ('freshness', {'verified_at_utc': 'DO-NOT-LOG'})]
        for reason, changes in cases:
            with self.subTest(reason=reason), self.assertRaises(PilotError) as caught:
                with diagnostic_gate('billing_proof'):
                    validate_proof(valid_proof() | changes, 'proj_test', 500)
            failure = safe_failure(caught.exception)
            self.assertEqual(failure['billing_reason'], reason)
            self.assertEqual(failure['stage'], 'billing_proof')
            self.assertNotIn('DO-NOT-LOG', json.dumps(failure))
        for budget in (True, 0, 501):
            with self.assertRaises(PilotError) as caught:
                validate_proof(valid_proof(), 'proj_test', budget)
            self.assertEqual(safe_failure(caught.exception)['billing_reason'], 'requested_budget')
        failure = PilotError('DO-NOT-LOG')
        failure._skycar_billing_reason = 'DO-NOT-LOG'
        self.assertNotIn('DO-NOT-LOG', json.dumps(safe_failure(failure)))

    def test_enforcement_evidence_is_allowlisted(self):
        for status, expected in [('enforcing', 'enforcing'), (None, 'missing'),
                                 ('DO-NOT-LOG', 'unrecognized')]:
            with self.subTest(status=status), self.assertRaises(PilotError) as caught:
                validate_proof(valid_proof() | {'enforcement': status}, 'proj_test', 500)
            failure = safe_failure(caught.exception)
            self.assertEqual(failure['enforcement_status'], expected)
            self.assertNotIn('DO-NOT-LOG', json.dumps(failure))
        self.assertEqual(validate_proof(valid_proof(), 'proj_test', 500)['enforcement'], 'inactive')

    def test_diagnostic_works_while_stopped_and_cannot_claim_or_code(self):
        sha = 'a'*40
        env = {'GITHUB_REPOSITORY': 'jimmoq-hopsup-Hoqde6/skycar-site',
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main',
               'GITHUB_SHA': sha, 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_RUN_ID': '123',
               'SKYCAR_EXECUTOR_ENABLED': 'false'}
        gh = Mock(); gh.main.return_value = sha
        billing = Mock(); billing.verify.return_value = valid_proof()
        with patch.dict(os.environ, env), patch('executor_pipeline.Ledger') as ledger, \
             patch('executor_pipeline.pilot.execute') as execute:
            result = verify_billing_only(sha, 'proj_test', 500, gh, billing)
            self.assertEqual(result['status'], 'billing_verified_NO_CODING')
            # Billing access can succeed even when the requested full budget
            # cannot fit: verification must not be mistaken for run authorization.
            self.assertEqual(result['remaining_headroom_cents'], 313)
            self.assertIs(result['full_request_fits'], False)
            gh.environment.assert_called_once()
            billing.verify.assert_called_once_with('proj_test', 500)
            ledger.assert_not_called(); execute.assert_not_called()
            gh.main.return_value = 'b'*40
            billing.reset_mock()
            with self.assertRaises(PilotError):verify_billing_only(sha, 'proj_test', 500, gh, billing)
            billing.verify.assert_not_called()
            gh.main.return_value = sha
            gh.environment.side_effect = PilotError('blocked')
            with self.assertRaises(PilotError):verify_billing_only(sha, 'proj_test', 500, gh, billing)
            billing.verify.assert_not_called()
            gh.environment.side_effect = None
            with patch.dict(os.environ, {'GITHUB_RUN_ATTEMPT': '2'}):
                with self.assertRaises(PilotError):verify_billing_only(sha, 'proj_test', 500, gh, billing)
            billing.verify.assert_not_called()


if __name__ == '__main__':unittest.main()
