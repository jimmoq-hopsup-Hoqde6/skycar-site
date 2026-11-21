"""Releasing a failed pre-artifact reservation keeps its record, budget and consumption."""
from copy import deepcopy
import json
import os
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock
import test_protected_executor as fixtures
from test_protected_executor import FakeGitHub, PREFIX, proof
from bounded_coding_pilot import PilotError
from executor_build_guard import OWNER_CHECKLIST, owner_acceptance_marker, require_build_attestation
from executor_diagnostics import safe_failure
from executor_ledger import Ledger, MAX_OWNER_ATTEMPTS, reserve, validate_state
from executor_pipeline import release_failed_reservation, verify_coding_key

PROJECT = 'proj_test'
TASK = fixtures.TASK_ID
FAILED_RUN = '44838598662'
MONTH = '2099-01'


def marker(n='1', supersedes=None):
    value = {'decision_id': 'D-009', 'attestation_sha256': n * 64}
    if supersedes is not None:
        value['supersedes_run_id'] = supersedes
    return value


def release_evidence(**changes):
    value = {'released_by_run_id': '777', 'failed_run_conclusion': 'failure',
             'observed_spend_cents': 187, 'limit_cents': 500,
             'verified_at_utc': '2099-01-01T00:00:00+00:00'}
    return dict(value, **changes)


def reserved_state(run_id=FAILED_RUN, sha='a' * 40, cents=313, owner=None):
    state = {'version': 1, 'project_id': PROJECT, 'active': None, 'months': {}, 'tasks': {}}
    state, key = reserve(state, PROJECT, TASK, sha, 'f' * 64, cents, run_id, MONTH,
                         marker() if owner is None else owner)
    return state, key


def released(state, key, **changes):
    state = deepcopy(state)
    state['tasks'][key].update(phase='released', release=release_evidence(**changes))
    state['active'] = None
    return validate_state(state, PROJECT)


class RunsGitHub(FakeGitHub):
    def __init__(self, runs=None, **kwargs):
        super().__init__(**kwargs)
        self.runs = runs or {}

    def request(self, method, path, body=None):
        route = path.removeprefix(PREFIX)
        if method == 'GET' and route.startswith('/actions/runs/'):
            self.calls.append((method, path, None))
            return deepcopy(self.runs[route.rsplit('/', 1)[-1]])
        return super().request(method, path, body)


def failed_run(run_id=FAILED_RUN, **changes):
    value = {'id': int(run_id), 'status': 'completed', 'conclusion': 'failure',
             'path': '.github/workflows/skycar-technician-executor.yml',
             'event': 'workflow_dispatch', 'head_branch': 'main'}
    return dict(value, **changes)


class LedgerReleaseTests(unittest.TestCase):
    def test_release_keeps_record_budget_and_blocks_replay(self):
        state, key = reserved_state()
        after = released(state, key)
        self.assertIsNone(after['active'])
        self.assertEqual(after['tasks'][key]['phase'], 'released')
        self.assertEqual(after['tasks'][key]['owner_risk_acceptance'], marker())
        self.assertEqual(after['months'], {MONTH: 313})
        with self.assertRaises(PilotError):
            reserve(after, PROJECT, TASK, 'a' * 40, 'f' * 64, 1, '900', MONTH)
        # The released budget still counts against the monthly ledger ceiling.
        with self.assertRaises(PilotError):
            reserve(after, PROJECT, TASK, 'b' * 40, 'e' * 64, 188, '900', MONTH)
        new, _ = reserve(after, PROJECT, TASK, 'b' * 40, 'e' * 64, 187, '900', MONTH)
        self.assertEqual(new['months'], {MONTH: 500})

    def test_failed_owner_attempt_stays_consumed_without_explicit_supersession(self):
        state, key = reserved_state()
        with self.assertRaises(PilotError):  # still active and unreleased
            reserve(state, PROJECT, TASK, 'b' * 40, 'e' * 64, 100, '900', MONTH,
                    marker('2', FAILED_RUN))
        after = released(state, key)
        for bad in (marker('2'), marker('2', '123'), marker('2', '900')):
            with self.subTest(marker=bad), self.assertRaises(PilotError):
                reserve(after, PROJECT, TASK, 'b' * 40, 'e' * 64, 100, '900', MONTH, bad)
        new, new_key = reserve(after, PROJECT, TASK, 'b' * 40, 'e' * 64, 100, '900', MONTH,
                               marker('2', FAILED_RUN))
        self.assertEqual(new['tasks'][key]['phase'], 'released')
        self.assertEqual(new['tasks'][new_key]['owner_risk_acceptance']['supersedes_run_id'], FAILED_RUN)
        # The same failed run cannot be superseded twice.
        again = released(new, new_key, released_by_run_id='778')
        with self.assertRaises(PilotError):
            reserve(again, PROJECT, TASK, 'c' * 40, 'd' * 64, 50, '901', MONTH,
                    marker('3', FAILED_RUN))

    def test_supersession_is_bounded(self):
        state, key = reserved_state(cents=1)
        run, sha = FAILED_RUN, 'a'
        for attempt in range(2, MAX_OWNER_ATTEMPTS + 1):
            state = released(state, key, released_by_run_id=str(1000 + attempt))
            nxt, sha = str(900 + attempt), chr(ord(sha) + 1)
            state, key = reserve(state, PROJECT, TASK, sha * 40, 'e' * 64, 1, nxt, MONTH,
                                 marker(str(attempt), run))
            run = nxt
        state = released(state, key, released_by_run_id='5000')
        with self.assertRaises(PilotError):
            reserve(state, PROJECT, TASK, 'z'.replace('z', 'f') * 40, 'e' * 64, 1, '999', MONTH,
                    marker('9', run))

    def test_supersede_marker_requires_something_to_supersede(self):
        empty = {'version': 1, 'project_id': PROJECT, 'active': None, 'months': {}, 'tasks': {}}
        with self.assertRaises(PilotError):
            reserve(empty, PROJECT, TASK, 'a' * 40, 'f' * 64, 1, '1', MONTH, marker('1', '2'))

    def test_invalid_release_states_fail_closed(self):
        state, key = reserved_state()
        good = released(state, key)
        cases = [
            lambda s: s['tasks'][key].pop('release'),
            lambda s: s['tasks'][key]['release'].update(extra=1),
            lambda s: s['tasks'][key]['release'].update(released_by_run_id=FAILED_RUN),
            lambda s: s['tasks'][key]['release'].update(failed_run_conclusion='success'),
            lambda s: s['tasks'][key]['release'].update(observed_spend_cents=500),
            lambda s: s['tasks'][key]['release'].update(limit_cents=501),
            lambda s: s['tasks'][key].update(session_id='sess_x'),
            lambda s: s['months'].update({MONTH: 0}),
            lambda s: s['tasks'][key].update(phase='reserved'),  # evidence on unreleased task
        ]
        for i, change in enumerate(cases):
            bad = deepcopy(good); change(bad)
            if i == len(cases) - 1:
                bad['active'] = key
            with self.subTest(case=i), self.assertRaises(PilotError):
                validate_state(bad, PROJECT)

    def test_two_live_owner_runs_are_impossible(self):
        state, key = reserved_state()
        bad = deepcopy(state)
        bad['tasks']['other@' + 'b' * 40] = dict(bad['tasks'][key], run_id='900',
                                                owner_risk_acceptance=marker('2', FAILED_RUN))
        bad['months'][MONTH] = 626
        with self.assertRaises(PilotError):
            validate_state(bad, PROJECT)


class ReleaseOperationTests(unittest.TestCase):
    def setUp(self):
        self.env = {'GITHUB_REPOSITORY': fixtures.pilot.REPOSITORY, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                    'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ATTEMPT': '1',
                    'GITHUB_RUN_ID': '777', 'SKYCAR_EXECUTOR_ENABLED': 'false'}
        self.old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)
        self.addCleanup(self.restore)
        self.gh = RunsGitHub(runs={FAILED_RUN: failed_run()})
        self.ledger = Ledger(self.gh, PROJECT)
        self.ledger.initialize()
        self.key = self.ledger.claim(TASK, 'b' * 40, 'f' * 64, 313, FAILED_RUN, owner_acceptance=marker())
        self.billing = NS(verify=Mock(return_value=proof(observed_spend_cents=187)))

    def restore(self):
        for k, v in self.old.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

    def test_release_records_live_billing_and_keeps_the_record(self):
        result = release_failed_reservation('a' * 40, PROJECT, FAILED_RUN, self.gh, self.billing)
        self.assertEqual(result['status'], 'reservation_released_RECORD_KEPT')
        self.assertEqual(result['remaining_headroom_cents'], 313)
        self.billing.verify.assert_called_once_with(PROJECT, 1, False)
        state = self.ledger.load()[1]
        entry = state['tasks'][self.key]
        self.assertIsNone(state['active'])
        self.assertEqual(entry['phase'], 'released')
        self.assertEqual(entry['release']['released_by_run_id'], '777')
        self.assertEqual(entry['release']['observed_spend_cents'], 187)
        self.assertEqual(state['months'][entry['month']], 313)
        with self.assertRaises(PilotError):  # nothing left to release
            release_failed_reservation('a' * 40, PROJECT, FAILED_RUN, self.gh, self.billing)

    def test_only_a_completed_failed_executor_run_can_be_released(self):
        for change in ({'conclusion': 'success'}, {'status': 'in_progress'},
                       {'path': '.github/workflows/ci.yml'}, {'event': 'push'},
                       {'head_branch': 'agent/x'}, {'id': 1}):
            self.gh.runs[FAILED_RUN] = failed_run(**change)
            with self.subTest(change=change), self.assertRaises(PilotError) as caught:
                release_failed_reservation('a' * 40, PROJECT, FAILED_RUN, self.gh, self.billing)
            self.assertEqual(safe_failure(caught.exception)['stage'], 'failed_run')
        self.billing.verify.assert_not_called()
        self.assertEqual(self.ledger.load()[1]['active'], self.key)

    def test_wrong_or_current_run_id_and_moved_main_are_rejected(self):
        for run_id in ('', '0', '777', 'x1'):
            with self.subTest(run_id=run_id), self.assertRaises(PilotError):
                release_failed_reservation('a' * 40, PROJECT, run_id, self.gh, self.billing)
        self.gh.runs['555'] = failed_run('555')
        with self.assertRaises(PilotError):  # completed failure, but not the lease holder
            release_failed_reservation('a' * 40, PROJECT, '555', self.gh, self.billing)
        self.gh.main_sha = 'c' * 40
        with self.assertRaises(PilotError):
            release_failed_reservation('a' * 40, PROJECT, FAILED_RUN, self.gh, self.billing)
        self.assertEqual(self.ledger.load()[1]['active'], self.key)

    def test_coded_reservation_cannot_be_released(self):
        self.ledger.advance(self.key, 'f' * 64, FAILED_RUN, 'reserved', 'coded',
                            artifact_sha256='a' * 64, session_id='sess_x')
        with self.assertRaises(PilotError):
            release_failed_reservation('a' * 40, PROJECT, FAILED_RUN, self.gh, self.billing)


class CodingKeyAndAcceptanceTests(unittest.TestCase):
    def test_coding_key_check_is_a_free_model_read(self):
        client = NS(models=NS(retrieve=Mock(return_value=NS(id=fixtures.pilot.MODEL))))
        self.assertEqual(verify_coding_key(client), 'authenticated')
        client.models.retrieve.assert_called_once_with(fixtures.pilot.MODEL)
        client.models.retrieve.side_effect = PilotError('401')
        with self.assertRaises(PilotError) as caught:
            verify_coding_key(client)
        self.assertEqual(safe_failure(caught.exception)['stage'], 'coding_key')

    def test_owner_acceptance_may_name_the_superseded_run(self):
        f = fixtures.PipelineTests(); f.setUp(); self.addCleanup(f.doCleanups)
        context = {'run_id': '900', 'project_id': PROJECT, 'task_id': TASK,
                   'budget_cents': 187, 'request_fingerprint': f.token}
        value = json.loads(fixtures.build_attestation(f.root, f.sha))
        value.update(context, reviewer=fixtures.pilot.REPOSITORY.split('/')[0],
                     attestation_type='owner_risk_acceptance', independent_review=False,
                     decision_id='D-009', draft_only=True, max_runs=1,
                     checklist={key: True for key in OWNER_CHECKLIST}, supersedes_run_id=FAILED_RUN)
        old = os.environ.get('SKYCAR_GENERATED_BUILD_ATTESTATION')
        self.addCleanup(lambda: os.environ.pop('SKYCAR_GENERATED_BUILD_ATTESTATION', None)
                        if old is None else os.environ.update(SKYCAR_GENERATED_BUILD_ATTESTATION=old))
        os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION'] = json.dumps(value)
        require_build_attestation(f.root, f.sha, context=context)
        self.assertEqual(owner_acceptance_marker()['supersedes_run_id'], FAILED_RUN)
        for bad in ('900', 900, '', '0'):
            os.environ['SKYCAR_GENERATED_BUILD_ATTESTATION'] = json.dumps(dict(value, supersedes_run_id=bad))
            with self.subTest(bad=bad), self.assertRaises(PilotError):
                require_build_attestation(f.root, f.sha, context=context)


if __name__ == '__main__':
    unittest.main()
