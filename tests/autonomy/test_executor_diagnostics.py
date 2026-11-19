"""Diagnostics reveal fixed gate names, never exception text or provider bodies."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts/autonomy'))
from bounded_coding_pilot import PilotError
from executor_diagnostics import diagnostic_gate, safe_failure
from executor_billing import ProviderBilling


class DiagnosticsTests(unittest.TestCase):
    def test_original_exception_and_safe_http_metadata_survive_nested_gates(self):
        failure = PilotError('DO-NOT-LOG-secret-key')
        failure.status_code = 403
        failure.body = {'secret': 'DO-NOT-LOG-response'}
        try:
            with diagnostic_gate('coding_session'):
                with diagnostic_gate('billing_costs'):
                    raise failure
        except PilotError as caught:
            self.assertIs(caught, failure)
            value = safe_failure(caught)
        self.assertEqual(value['stage'], 'billing_costs')
        self.assertEqual(value['http_status'], 403)
        self.assertNotIn('DO-NOT-LOG', json.dumps(value))

    def test_unknown_or_malformed_gate_never_prints_arbitrary_content(self):
        for gate in ('DO-NOT-LOG-key', [], None):
            failure = PilotError('DO-NOT-LOG-message')
            failure._skycar_gate = gate
            self.assertEqual(safe_failure(failure)['stage'], 'protected_executor')
            with self.assertRaises(PilotError):
                with diagnostic_gate('build_acceptance'):
                    raise failure
            self.assertEqual(safe_failure(failure)['stage'], 'build_acceptance')
        with self.assertRaises(ValueError):
            with diagnostic_gate('arbitrary-label'):
                self.fail('Unknown gate must not run')

    def test_billing_distinguishes_cost_project_hard_limit_and_proof_failures(self):
        for stage in ('billing_costs', 'billing_project', 'billing_hard_limit', 'billing_proof'):
            with self.subTest(stage=stage):
                client = Mock()
                org = client.admin.organization
                org.usage.costs.return_value = NS(data=[], has_more=False)
                org.projects.retrieve.return_value = NS(id='proj_test', status='active')
                org.projects.spend_limit.retrieve.return_value = NS(object='project.spend_limit',
                    currency='USD', interval='month', threshold_amount=500,
                    enforcement=NS(status='advisory'))
                failure = PilotError('DO-NOT-LOG-provider-body')
                targets = {'billing_costs': org.usage.costs, 'billing_project': org.projects.retrieve,
                           'billing_hard_limit': org.projects.spend_limit.retrieve}
                if stage in targets:
                    targets[stage].side_effect = failure
                with self.assertRaises(PilotError) as caught:
                    ProviderBilling(client).verify('proj_test', 500)
                self.assertEqual(safe_failure(caught.exception)['stage'], stage)
                self.assertNotIn('DO-NOT-LOG', json.dumps(safe_failure(caught.exception)))
                if stage == 'billing_costs':
                    org.projects.retrieve.assert_not_called()
                if stage in ('billing_costs', 'billing_project'):
                    org.projects.spend_limit.retrieve.assert_not_called()


if __name__ == '__main__':
    unittest.main()
