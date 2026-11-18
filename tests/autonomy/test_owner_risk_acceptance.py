"""One owner exception: exact invocation, immutable evidence, durable consumption."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import test_protected_executor as fixtures
from executor_build_guard import OWNER_CHECKLIST, owner_acceptance_marker, require_build_attestation
from executor_ledger import reserve, validate_state
from executor_pipeline import coding_run, publish


class OwnerAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.PipelineTests(); self.f.setUp(); self.addCleanup(self.f.doCleanups)
        self.context = {'run_id': '123', 'project_id': 'proj_test',
                        'task_id': fixtures.TASK_ID, 'budget_cents': 500,
                        'request_fingerprint': self.f.token}
        self.value = json.loads(fixtures.build_attestation(self.f.root, self.f.sha))
        self.value.update(self.context, reviewer=fixtures.pilot.REPOSITORY.split('/')[0],
                          attestation_type='owner_risk_acceptance', independent_review=False,
                          decision_id='D-009', draft_only=True, max_runs=1,
                          checklist={key: True for key in OWNER_CHECKLIST})
        self.install()

    def install(self):
        os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION'] = json.dumps(self.value)

    def check(self):
        return require_build_attestation(self.f.root, self.f.sha, context=self.context)

    def test_owner_can_finish_one_draft_and_is_never_labelled_independent(self):
        self.check(); self.f.code(); self.f.validation_receipt()
        entry = self.f.ledger.load()[1]['tasks'][fixtures.TASK_ID+'@'+self.f.sha]
        self.assertEqual(entry['owner_risk_acceptance'], owner_acceptance_marker())
        result = publish(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                         self.f.evidence,self.f.validation,self.f.gh,self.f.gh)
        self.assertEqual(result['status'], 'draft_pr_created_NOT_APPROVED')
        body = [b for m,p,b in self.f.gh.calls if m=='POST' and p==fixtures.PREFIX+'/pulls'][0]
        self.assertIs(body['draft'], True)
        self.assertIn('independent_review=false', body['body'])
        self.assertIn('D-009', body['body'])

    def test_invalid_or_changed_acceptance_is_rejected_before_any_provider_call(self):
        original = deepcopy(self.value)
        changes = [
            {'reviewer': 'moogly88'}, {'independent_review': True}, {'independent_review': 0},
            {'attestation_type': 'independent'}, {'decision_id': 'D-010'},
            {'source_sha': 'e'*40}, {'policy_sha256': 'e'*64},
            {'project_id': 'proj_other'}, {'task_id': 'other-task'},
            {'budget_cents': 499}, {'budget_cents': 501}, {'budget_cents': True},
            {'run_id': '124'}, {'run_id': 123}, {'request_fingerprint': 'f'*64},
            {'draft_only': False}, {'max_runs': 2}, {'max_runs': True},
            {'external_integrations_audited': False}, {'checklist': {}},
            {'expires_at_utc': (datetime.now(timezone.utc)+timedelta(hours=25)).isoformat()},
            {'expires_at_utc': (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()}
        ]
        for key in OWNER_CHECKLIST:
            changes.append({'checklist': dict(original['checklist'], **{key: False})})
        for change in changes:
            with self.subTest(change=change):
                self.value = dict(original, **change); self.install()
                client, sessions = fixtures.fake_client(); client.project='proj_test'
                billing = NS(verify=Mock())
                with self.assertRaises(fixtures.pilot.PilotError):
                    coding_run(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                               self.f.evidence,self.f.gh,client,billing)
                billing.verify.assert_not_called(); sessions.create.assert_not_called()
                self.assertIsNone(self.f.ledger.load()[1]['active'])

    def test_missing_context_and_missing_or_extra_fields_fail_closed(self):
        with self.assertRaises(fixtures.pilot.PilotError):
            require_build_attestation(self.f.root,self.f.sha)
        original = deepcopy(self.value)
        for field in original:
            self.value = dict(original); self.value.pop(field); self.install()
            with self.subTest(missing=field), self.assertRaises(fixtures.pilot.PilotError): self.check()
        self.value = dict(original, unexpected=True); self.install()
        with self.assertRaises(fixtures.pilot.PilotError): self.check()

    def test_published_owner_exception_cannot_be_reused_with_new_sha_month_or_marker(self):
        self.f.code(); self.f.validation_receipt()
        publish(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                self.f.evidence,self.f.validation,self.f.gh,self.f.gh)
        state = self.f.ledger.load()[1]
        for marker in (owner_acceptance_marker(), {'decision_id':'D-009','attestation_sha256':'f'*64}):
            with self.assertRaises(fixtures.pilot.PilotError):
                reserve(state,'proj_test',fixtures.TASK_ID,'c'*40,'d'*64,1,'999','2099-01',marker)
        # The original independent path is not turned into a one-owner-run policy.
        new, _ = reserve(state,'proj_test',fixtures.TASK_ID,'c'*40,'d'*64,1,'999','2099-01')
        validate_state(new,'proj_test')

    def test_uncertain_session_creation_consumes_owner_exception(self):
        client,sessions=fixtures.fake_client();client.project='proj_test'
        sessions.create.side_effect=TimeoutError('unknown creation')
        billing=NS(verify=Mock(side_effect=lambda *_:fixtures.proof()))
        with self.assertRaises(TimeoutError):
            coding_run(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                       self.f.evidence,self.f.gh,client,billing)
        state=self.f.ledger.load()[1]
        self.assertIsNotNone(state['active'])
        self.assertIn('owner_risk_acceptance', next(iter(state['tasks'].values())))
        sessions.stream.assert_not_called()
        with self.assertRaises(fixtures.pilot.PilotError):
            reserve(state,'proj_test',fixtures.TASK_ID,'c'*40,'d'*64,1,'999','2099-01',owner_acceptance_marker())

    def test_changed_or_switched_acceptance_cannot_publish(self):
        self.f.code(); self.f.validation_receipt()
        original=deepcopy(self.value)
        mutations=[dict(original,expires_at_utc=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()),
                   json.loads(fixtures.build_attestation(self.f.root,self.f.sha))]
        for value in mutations:
            self.value=value; self.install(); before=len(self.f.gh.calls)
            with self.assertRaises(fixtures.pilot.PilotError):
                publish(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                        self.f.evidence,self.f.validation,self.f.gh,self.f.gh)
            self.assertFalse(any(m!='GET' for m,_,_ in self.f.gh.calls[before:]))
            self.assertEqual(self.f.gh.pulls,[])

    def test_duplicate_json_keys_are_not_a_signature(self):
        raw=json.dumps(self.value)
        os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION']=raw[:-1]+',"independent_review":true}'
        with self.assertRaises(fixtures.pilot.PilotError): self.check()

    def test_consumed_acceptance_cannot_be_renewed_after_success_or_month_change(self):
        self.f.code(); self.f.validation_receipt()
        publish(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                self.f.evidence,self.f.validation,self.f.gh,self.f.gh)
        state=self.f.ledger.load()[1]
        self.assertIsNone(state['active'])
        renewed=dict(owner_acceptance_marker(), attestation_sha256='f'*64)
        for month in ('2099-01', '2099-02'):
            with self.subTest(month=month), self.assertRaises(fixtures.pilot.PilotError):
                fixtures.reserve(state,'proj_test',fixtures.TASK_ID,'c'*40,'d'*64,1,'999',month,renewed)

    def test_atomic_owner_claim_failure_never_creates_a_paid_session(self):
        self.f.gh.cas_failure=True
        client,sessions=fixtures.fake_client();client.project='proj_test'
        billing=NS(verify=fixtures.Mock(side_effect=lambda *_:fixtures.proof()))
        with self.assertRaises(fixtures.GitHubError):
            coding_run(self.f.root,self.f.sha,fixtures.TASK_ID,'proj_test',500,self.f.token,
                       self.f.evidence,self.f.gh,client,billing)
        sessions.create.assert_not_called()
        self.assertIsNone(self.f.ledger.load()[1]['active'])

    def test_independent_attestation_retains_unchanged_schema_and_owner_rejection(self):
        os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION']=fixtures.build_attestation(self.f.root,self.f.sha)
        require_build_attestation(self.f.root,self.f.sha)
        self.assertIsNone(owner_acceptance_marker())
        os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION']=fixtures.build_attestation(
            self.f.root,self.f.sha,reviewer=fixtures.pilot.REPOSITORY.split('/')[0])
        with self.assertRaises(fixtures.pilot.PilotError):
            require_build_attestation(self.f.root,self.f.sha)


if __name__=='__main__': unittest.main()
