import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).resolve().parents[2] / 'scripts/autonomy/bounded_coding_pilot.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def payload():
    return {'task_id': pilot.TASK_ID, 'files': [{'path': p, 'content': '# safe text\n'} for p in pilot.ALLOWED_FILES]}


class Context:
    def __init__(self, value): self.value = value
    def __enter__(self): return self.value
    def __exit__(self, *args): pass


def fake_client(raw=None, failed=False):
    sessions = Mock()
    sessions.create.return_value = NS(id='sess_test', spend_control=NS(limit=100))
    stream = Mock()
    stream.__iter__ = Mock(return_value=iter([]))
    stream.get_final_result.return_value = NS(session_id='sess_test', turn_id='turn_test')
    if failed: stream.get_final_result.side_effect = RuntimeError('failed root turn')
    sessions.stream.return_value = Context(stream)
    sessions.artifacts.list.return_value = [NS(id='artifact_test', turn_id='turn_test', path='/workspace/outputs/changes.json')]
    response = NS(iter_bytes=lambda: iter([raw if raw is not None else json.dumps(payload()).encode()]))
    sessions.artifacts.with_streaming_response.content.return_value = Context(response)
    sessions.retrieve.return_value = NS(status='idle', environment=NS(id='env_test'))
    environments = Mock()
    environments.retrieve.return_value = NS(status='connected')
    return NS(beta=NS(agents=NS(sessions=sessions, environments=environments))), sessions


class PilotTests(unittest.TestCase):
    def request(self, cents=100):
        return pilot.build_request({p: b'# source\n' for p in pilot.ALLOWED_FILES}, 'a'*40, cents)
    def test_request_has_server_budget_and_no_network_credentials_or_tools(self):
        r = self.request()
        self.assertEqual(r['spend_control'], {'limit': 100})
        self.assertEqual(r['environment']['network'], {'access': 'disabled'})
        self.assertEqual(r['environment']['env'], {})
        self.assertEqual(r['agent']['tools'], [])
        self.assertFalse(r['agent']['multi_agent']['enabled'])
        self.assertNotIn('input', r)  # Persist session ID before coding starts.
        self.assertNotIn('vault_ids', r)
    def test_budget_out_of_range_and_bool_rejected(self):
        for n in (0, -1, 501, True, 1.5):
            with self.subTest(n=n), self.assertRaises(pilot.PilotError): self.request(n)
    def test_approval_binds_budget_model_source_and_sha(self):
        r = self.request()
        variants = [self.request(99), copy.deepcopy(r), copy.deepcopy(r), copy.deepcopy(r)]
        variants[1]['agent']['model'] = 'other'
        variants[2]['environment']['files'][0]['data'] = base64.b64encode(b'different').decode()
        variants[3]['metadata']['commit'] = 'b'*40
        for item in variants: self.assertNotEqual(pilot.fingerprint(item), pilot.fingerprint(r))
    def test_unexpected_source_scope_rejected(self):
        with self.assertRaises(pilot.PilotError): pilot.build_request({'.env': b'secret'}, 'a'*40, 100)
    def test_valid_artifact(self):
        self.assertEqual(set(pilot.validate_artifact(json.dumps(payload()).encode())), set(pilot.ALLOWED_FILES))
    def test_output_path_attacks_rejected(self):
        for path in ('../.env', '/tmp/output', '.github/workflows/ci.yml', 'scripts/autonomy/../queue_dry_run.py', 2, None):
            p = payload(); p['files'][0]['path'] = path
            with self.subTest(path=path), self.assertRaises(pilot.PilotError): pilot.validate_artifact(json.dumps(p).encode())
    def test_duplicate_missing_extra_files_rejected(self):
        for files in ([], payload()['files'][:1], [payload()['files'][0]]*2):
            p = payload(); p['files'] = files
            with self.assertRaises(pilot.PilotError): pilot.validate_artifact(json.dumps(p).encode())
    def test_unknown_keys_wrong_task_and_nul_rejected(self):
        for p in (dict(payload(), surprise=True), dict(payload(), task_id='other')):
            with self.assertRaises(pilot.PilotError): pilot.validate_artifact(json.dumps(p).encode())
        p = payload(); p['files'][0]['content'] = 'x\0'
        with self.assertRaises(pilot.PilotError): pilot.validate_artifact(json.dumps(p).encode())
    def test_size_limits_and_duplicate_json_keys(self):
        with self.assertRaises(pilot.PilotError): pilot.validate_artifact(b' '*160001)
        with self.assertRaises(pilot.PilotError): pilot.validate_artifact(b'{"task_id":1,"task_id":2}')
        p = payload(); p['files'][0]['content'] = 'x'*64001
        with self.assertRaises(pilot.PilotError): pilot.validate_artifact(json.dumps(p).encode())
    def test_source_uses_commit_not_dirty_worktree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            for p in pilot.ALLOWED_FILES:
                (root/p).parent.mkdir(parents=True, exist_ok=True); (root/p).write_text('# original\n')
            subprocess.run(['git','-C',str(root),'add','.'], check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'], check=True)
            sha = pilot.git(root,'rev-parse','HEAD').decode().strip()
            (root/pilot.ALLOWED_FILES[0]).write_text('dirty secret')
            self.assertEqual(pilot.source_snapshot(root,sha)[pilot.ALLOWED_FILES[0]], b'# original\n')
            with self.assertRaises(pilot.PilotError): pilot.source_snapshot(root, 'b'*40)
    def run_fake(self, **kwargs):
        client, sessions = fake_client(**kwargs)
        return client, sessions
    def test_wrong_approval_makes_no_api_call(self):
        client,sessions = self.run_fake()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(pilot.PilotError): pilot.execute(client,self.request(),Path(tmp)/'out','wrong')
        sessions.create.assert_not_called()
    def test_success_records_ids_and_artifact_but_not_test_claim(self):
        client,sessions = self.run_fake(); r = self.request()
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'out'; state=pilot.execute(client,r,out,pilot.fingerprint(r))
            self.assertEqual(state['status'],'artifact_validated_NOT_TESTED')
            self.assertEqual(state['turn_id'],'turn_test')
            self.assertTrue((out/'changes.json').exists())
            self.assertEqual(state['cleanup'],'deletion_requested')
            with self.assertRaises(FileExistsError): pilot.execute(client,r,out,pilot.fingerprint(r))
        self.assertEqual(sessions.create.call_count,1)
    def test_failed_turn_never_downloads_or_reports_success(self):
        client,sessions=self.run_fake(failed=True); r=self.request()
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'out'
            with self.assertRaises(RuntimeError): pilot.execute(client,r,out,pilot.fingerprint(r))
            self.assertEqual(json.loads((out/'state.json').read_text())['status'],'blocked_reconcile_before_retry')
            self.assertFalse((out/'changes.json').exists())
        sessions.artifacts.list.assert_not_called(); sessions.delete.assert_called_once()
    def test_unconfirmed_budget_blocks_task(self):
        client,sessions=self.run_fake(); r=self.request()
        sessions.create.return_value.spend_control=None
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(pilot.PilotError): pilot.execute(client,r,Path(tmp)/'out',pilot.fingerprint(r))
        sessions.stream.assert_not_called()
    def test_ambiguous_or_wrong_turn_artifact_rejected(self):
        for artifacts in ([], [NS(id='x', turn_id='different', path='/workspace/outputs/changes.json')], [NS(id='x', turn_id='turn_test', path='/workspace/outputs/changes.json')]*2):
            client,sessions=self.run_fake(); r=self.request(); sessions.artifacts.list.return_value=artifacts
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(pilot.PilotError): pilot.execute(client,r,Path(tmp)/'out',pilot.fingerprint(r))
    def test_cleanup_failure_blocks_next_action(self):
        client,sessions=self.run_fake(); r=self.request(); sessions.delete.side_effect=RuntimeError('cleanup')
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'out'
            with self.assertRaises(pilot.PilotError): pilot.execute(client,r,out,pilot.fingerprint(r))
            self.assertEqual(json.loads((out/'state.json').read_text())['cleanup'],'pending_manual_reconciliation')
    def test_provisioning_waits_before_submitting_task(self):
        client,sessions=self.run_fake(); r=self.request()
        client.beta.agents.environments.retrieve.side_effect=[NS(status='provisioning'),NS(status='connected')]
        with tempfile.TemporaryDirectory() as tmp, patch.object(pilot.time,'sleep') as sleep:
            pilot.execute(client,r,Path(tmp)/'out',pilot.fingerprint(r))
            sleep.assert_called_once_with(2)
        sessions.stream.assert_called_once()
    def test_failed_environment_does_not_start_coding(self):
        client,sessions=self.run_fake(); r=self.request()
        client.beta.agents.environments.retrieve.return_value=NS(status='failed')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(pilot.PilotError): pilot.execute(client,r,Path(tmp)/'out',pilot.fingerprint(r))
        sessions.stream.assert_not_called(); sessions.delete.assert_called_once()
    def test_sigterm_runs_cleanup(self):
        import os,signal
        client,sessions=self.run_fake(); r=self.request()
        sessions.stream.return_value.value.get_final_result.side_effect=lambda: os.kill(os.getpid(), signal.SIGTERM)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(pilot.PilotError): pilot.execute(client,r,Path(tmp)/'out',pilot.fingerprint(r))
        sessions.delete.assert_called_once()
    def test_unknown_creation_outcome_recorded_not_retried(self):
        client,sessions=self.run_fake(); r=self.request(); sessions.create.side_effect=RuntimeError('network')
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'out'
            with self.assertRaises(RuntimeError): pilot.execute(client,r,out,pilot.fingerprint(r))
            self.assertEqual(json.loads((out/'state.json').read_text())['cleanup'],'creation_outcome_unknown_do_not_retry')
        sessions.create.assert_called_once(); sessions.stream.assert_not_called()


class ProjectBudgetTests(unittest.TestCase):
    request = PilotTests.request

    def receipt(self, **changes):
        value = {'mode': pilot.PROJECT_BUDGET_MODE, 'project_id': 'proj_test',
                 'sha': 'a'*40, 'task': pilot.TASK_ID, 'hard_limit_enforced': True,
                 'limit_cents': 100, 'observed_spend_cents': 0,
                 'verified_at_utc': datetime.now(timezone.utc).isoformat()}
        return dict(value, **changes)

    def validate(self, receipt, request=None, **kwargs):
        return pilot.validate_project_budget(receipt, self.request() if request is None else request,
                                             expected_project_id='proj_test', **kwargs)

    def test_budget_boundaries_and_default(self):
        self.assertEqual(self.request()['spend_control'], {'limit': 100})
        for n in (1, 101, 500):
            self.assertEqual(self.request(n)['spend_control']['limit'], n)
            self.validate(self.receipt(limit_cents=n), self.request(n))
        for n in (False, None, '100', 100.0):
            with self.subTest(n=n), self.assertRaises(pilot.PilotError):
                self.request(n)

    def test_normalization_freshness_boundaries_and_no_mutation(self):
        now = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
        r = self.request()
        for age in (0, 300):
            receipt = self.receipt(verified_at_utc=(now - timedelta(seconds=age)).isoformat())
            receipt['verified_at_utc'] = receipt['verified_at_utc'].replace('+00:00', 'Z')
            before = copy.deepcopy((receipt, r))
            normalized = self.validate(receipt, r, now=now)
            self.assertIsNot(normalized, receipt)
            self.assertTrue(normalized['verified_at_utc'].endswith('+00:00'))
            self.assertEqual((receipt, r), before)
        receipt = self.receipt(verified_at_utc='2026-11-16T13:00:00+01:00')
        self.assertEqual(self.validate(receipt, now=now)['verified_at_utc'], now.isoformat())
        for bad_now in (now.replace(tzinfo=None), 'now'):
            with self.assertRaises(pilot.PilotError): self.validate(receipt, now=bad_now)
        for age in (-0.001, 300.001):
            with self.assertRaises(pilot.PilotError):
                self.validate(self.receipt(verified_at_utc=(now-timedelta(seconds=age)).isoformat()), now=now)

    def test_invalid_receipts_make_zero_api_calls_or_output(self):
        now = datetime.now(timezone.utc)
        changes = [
            {'mode': 'session'}, {'project_id': 'proj_other'}, {'project_id': 'test'},
            {'project_id': 'proj_'}, {'project_id': 'proj_bad/path'},
            {'sha': 'b'*40}, {'task': 'other'}, {'hard_limit_enforced': False},
            {'hard_limit_enforced': 1}, {'hard_limit_enforced': 'true'},
            {'limit_cents': 101}, {'limit_cents': 501}, {'limit_cents': 0},
            {'limit_cents': True}, {'limit_cents': 1.0}, {'limit_cents': '100'},
            {'observed_spend_cents': -1}, {'observed_spend_cents': 100},
            {'observed_spend_cents': True}, {'observed_spend_cents': 0.0},
            {'verified_at_utc': 'invalid'}, {'verified_at_utc': '2026-11-16T12:00:00'},
            {'verified_at_utc': (now-timedelta(seconds=301)).isoformat()},
            {'verified_at_utc': (now+timedelta(seconds=60)).isoformat()},
            {'extra': True},
        ]
        invalid = [self.receipt(**change) for change in changes] + [[], 'receipt', {}]
        for key in self.receipt():
            missing = self.receipt(); del missing[key]; invalid.append(missing)
            invalid.append(self.receipt(**{key: None}))
        for receipt in invalid:
            with self.subTest(receipt=receipt), tempfile.TemporaryDirectory() as tmp:
                client, sessions = fake_client(); client.project = 'proj_test'
                out = Path(tmp)/'out'; r = self.request()
                with self.assertRaises(pilot.PilotError):
                    pilot.execute(client, r, out, pilot.fingerprint(r, receipt), project_budget=receipt)
                self.assertFalse(out.exists())
                self.assertEqual(sessions.mock_calls, [])
                self.assertEqual(client.beta.agents.environments.mock_calls, [])

    def test_invalid_request_budget_metadata_or_client_project(self):
        for ceiling in (True, 0, 501, 100.0):
            r = self.request(); r['spend_control']['limit'] = ceiling
            with self.assertRaises(pilot.PilotError): self.validate(self.receipt(), r)
        for key in ('commit', 'task'):
            r = self.request(); r['metadata'][key] = 'other'
            with self.assertRaises(pilot.PilotError): self.validate(self.receipt(), r)
        for project in (None, 'proj_other', 1):
            client, sessions = fake_client(); client.project = project
            r = self.request(); receipt = self.receipt()
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)/'out'
                with self.assertRaises(pilot.PilotError):
                    pilot.execute(client, r, out, pilot.fingerprint(r, receipt), project_budget=receipt)
                self.assertFalse(out.exists())
                self.assertEqual(sessions.mock_calls, [])

    def test_project_success_omits_session_budget_preserves_controls_and_input(self):
        for returned_budget in (None, NS(limit=999)):
            client, sessions = fake_client(); client.project = 'proj_test'
            sessions.create.return_value.spend_control = returned_budget
            r = self.request(); receipt = self.receipt(verified_at_utc=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
            before = copy.deepcopy((r, receipt))
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)/'out'
                state = pilot.execute(client, r, out, pilot.fingerprint(r, receipt), project_budget=receipt)
                self.assertEqual(state['budget_mode'], pilot.PROJECT_BUDGET_MODE)
                self.assertEqual(state['project_budget'], self.validate(receipt))
                self.assertEqual(state['status'], 'artifact_validated_NOT_TESTED')
                self.assertEqual(state['cleanup'], 'deletion_requested')
                self.assertEqual(json.loads((out/'state.json').read_text()), state)
                self.assertTrue((out/'changes.json').exists())
            expected = copy.deepcopy(r); del expected['spend_control']
            sessions.create.assert_called_once_with(**expected)
            sessions.stream.assert_called_once()
            sessions.delete.assert_called_once_with('sess_test')
            self.assertEqual((r, receipt), before)

    def test_fingerprint_preserves_session_algorithm_and_binds_project_mode(self):
        r = self.request(); receipt = self.receipt()
        legacy = hashlib.sha256(json.dumps({'request': r, 'input': pilot.TASK}, sort_keys=True).encode()).hexdigest()
        self.assertEqual(pilot.fingerprint(r), legacy)
        self.assertEqual(pilot.fingerprint(r, None), legacy)
        token = pilot.fingerprint(r, receipt)
        self.assertNotEqual(token, legacy)
        for key, value in receipt.items():
            changed = dict(receipt, **{key: str(value)+'changed'})
            self.assertNotEqual(pilot.fingerprint(r, changed), token)
        for key in ('agent', 'environment', 'metadata'):
            changed = copy.deepcopy(r); changed[key]['extra'] = 'changed'
            self.assertNotEqual(pilot.fingerprint(changed, receipt), token)
        with patch.object(pilot, 'TASK', 'changed task'):
            self.assertNotEqual(pilot.fingerprint(r, receipt), token)
        expected = {'request': {k: v for k, v in r.items() if k != 'spend_control'},
                    'input': pilot.TASK, 'budget_mode': pilot.PROJECT_BUDGET_MODE, 'project_budget': receipt}
        self.assertEqual(token, hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest())

    def test_project_approval_is_mandatory_and_binds_receipt(self):
        r = self.request(); receipt = self.receipt()
        tokens = ('', 'wrong', pilot.fingerprint(r),
                  pilot.fingerprint(r, dict(receipt, observed_spend_cents=1)))
        for token in tokens:
            client, sessions = fake_client(); client.project = 'proj_test'
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)/'out'
                with self.assertRaises(pilot.PilotError):
                    pilot.execute(client, r, out, token, project_budget=receipt)
                self.assertFalse(out.exists())
            self.assertEqual(sessions.mock_calls, [])

    def test_expiry_during_provisioning_rechecks_and_cleans_up(self):
        client, sessions = fake_client(); client.project = 'proj_test'
        sessions.create.return_value.spend_control = None
        r = self.request(); receipt = self.receipt()
        verified = datetime.fromisoformat(receipt['verified_at_utc'])
        validation = pilot.validate_project_budget
        times = iter((verified, verified+timedelta(seconds=301)))
        def timed_validation(*args, **kwargs):
            return validation(*args, **kwargs, now=next(times))
        client.beta.agents.environments.retrieve.side_effect = [NS(status='provisioning'), NS(status='connected')]
        with tempfile.TemporaryDirectory() as tmp, patch.object(pilot.time, 'sleep'), \
                patch.object(pilot, 'validate_project_budget', side_effect=timed_validation) as check:
            out = Path(tmp)/'out'
            with self.assertRaises(pilot.PilotError):
                pilot.execute(client, r, out, pilot.fingerprint(r, receipt), project_budget=receipt)
            self.assertEqual(check.call_count, 2)
            state = json.loads((out/'state.json').read_text())
            self.assertEqual(state['status'], 'blocked_reconcile_before_retry')
            self.assertEqual(state['cleanup'], 'deletion_requested')
            self.assertFalse((out/'changes.json').exists())
        sessions.stream.assert_not_called(); sessions.artifacts.list.assert_not_called()
        sessions.delete.assert_called_once(); sessions.events.create.assert_called_once()

    def test_project_identity_rechecked_after_provisioning(self):
        client, sessions = fake_client(); client.project = 'proj_test'
        r = self.request(); receipt = self.receipt()
        def switch_project(*args):
            client.project = 'proj_other'
            return NS(status='connected')
        client.beta.agents.environments.retrieve.side_effect = switch_project
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(pilot.PilotError):
                pilot.execute(client, r, Path(tmp)/'out', pilot.fingerprint(r, receipt), project_budget=receipt)
        sessions.stream.assert_not_called(); sessions.delete.assert_called_once()

    def test_session_mode_still_requires_exact_server_budget_and_never_retries(self):
        r = self.request()
        for budget in (None, NS(limit=99)):
            client, sessions = fake_client(); sessions.create.return_value.spend_control = budget
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(pilot.PilotError):
                    pilot.execute(client, r, Path(tmp)/'out', pilot.fingerprint(r))
            sessions.create.assert_called_once_with(**r)
            sessions.stream.assert_not_called(); sessions.delete.assert_called_once()
        client, sessions = fake_client()
        sessions.create.side_effect = RuntimeError('spend_control rejected')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):
                pilot.execute(client, r, Path(tmp)/'out', pilot.fingerprint(r))
        sessions.create.assert_called_once_with(**r); sessions.stream.assert_not_called()

    def test_secure_confirmation_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp); root = parent/'checkout'; root.mkdir()
            path = parent/'receipt.json'; receipt = self.receipt()
            path.write_text(json.dumps(receipt), encoding='utf-8'); path.chmod(0o600)
            self.assertEqual(pilot.load_project_budget(path, root), receipt)
            path.chmod(0o400)
            self.assertEqual(pilot.load_project_budget(path, root), receipt)
            for mode in (0o640, 0o604, 0o601, 0o610, 0o666):
                path.chmod(mode)
                with self.subTest(mode=mode), self.assertRaises(pilot.PilotError):
                    pilot.load_project_budget(path, root)
            path.chmod(0o600)
            with patch.object(pilot.os, 'getuid', return_value=os.getuid()+1):
                with self.assertRaises(pilot.PilotError): pilot.load_project_budget(path, root)
            inside = root/'receipt.json'; inside.write_text(json.dumps(receipt)); inside.chmod(0o600)
            link = parent/'link'; link.symlink_to(path)
            directory = parent/'alias'; directory.symlink_to(parent, target_is_directory=True)
            dangling = parent/'dangling'; dangling.symlink_to(parent/'missing')
            fifo = parent/'fifo'; os.mkfifo(fifo, 0o600)
            for bad in (inside, Path('/'+str(inside)), link, directory/path.name, dangling,
                        fifo, root, parent/'missing', root/'..'/path.name):
                with self.subTest(path=bad), self.assertRaises(pilot.PilotError):
                    pilot.load_project_budget(bad, root)

    def test_confirmation_json_and_byte_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'receipt.json'; root = Path(tmp)/'checkout'; root.mkdir()
            good = json.dumps(self.receipt()).encode()
            for raw in (b'{', b'[]', b'null', b'{"a":1,"a":2}', b'{"a":{"b":1,"b":2}}',
                        b'{"a":NaN}', b'{"a":Infinity}', b'\xff', b' '*4097,
                        b'{}'+b' '*4095, b'\xff\xfe{\x00}\x00'):
                path.write_bytes(raw); path.chmod(0o600)
                with self.subTest(raw=raw[:40]), self.assertRaises(pilot.PilotError):
                    pilot.load_project_budget(path, root)
            path.write_bytes(good + b' '*(4096-len(good)))
            self.assertEqual(pilot.load_project_budget(path, root), json.loads(good))

    def cli(self, args):
        return patch.object(pilot.sys, 'argv', ['pilot', '--sha', 'a'*40, *args])

    def test_cli_offline_preflight_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'checkout'; root.mkdir()
            path = Path(tmp)/'receipt.json'; receipt = self.receipt()
            path.write_text(json.dumps(receipt)); path.chmod(0o600)
            for project in (False, True):
                args = ['--root', str(root)]
                if project:
                    args += ['--budget-mode', 'project', '--project-id', 'proj_test',
                             '--project-budget-confirmation', str(path)]
                stdout = io.StringIO()
                with self.cli(args), patch.object(pilot, 'source_snapshot', return_value={p: b'# source\n' for p in pilot.ALLOWED_FILES}), \
                        patch.object(pilot.sys, 'stdout', stdout), patch.object(pilot, 'execute') as execute:
                    pilot.main()
                preflight = json.loads(stdout.getvalue())
                self.assertEqual(preflight['budget_mode'], 'project' if project else 'session')
                self.assertEqual(preflight['mode'], 'offline_preflight')
                execute.assert_not_called()
                if project:
                    self.assertEqual(preflight['project_id'], 'proj_test')
                    self.assertEqual(preflight['project_budget'], self.validate(receipt))
                    self.assertNotIn('session_budget_cents', preflight)
                else:
                    self.assertEqual(preflight['session_budget_cents'], 100)
                self.assertEqual(preflight['request_fingerprint'],
                                 pilot.fingerprint(self.request(), self.validate(receipt) if project else None))

    def test_cli_rejects_missing_or_misplaced_project_arguments(self):
        cases = [ ['--project-id', 'proj_test'], ['--project-budget-confirmation', '/unused'],
                  ['--budget-mode', 'project'],
                  ['--budget-mode', 'project', '--project-id', 'proj_test'],
                  ['--budget-mode', 'project', '--project-budget-confirmation', '/unused'] ]
        for args in cases:
            with self.subTest(args=args), self.cli(args), patch.object(pilot.sys, 'stderr', io.StringIO()), \
                    patch.object(pilot, 'source_snapshot') as snapshot:
                with self.assertRaises(SystemExit): pilot.main()
                snapshot.assert_not_called()

    def test_cli_passes_explicit_project_only_in_project_mode(self):
        for project in (False, True):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)/'checkout'; root.mkdir()
                path = Path(tmp)/'receipt.json'; receipt = self.receipt()
                path.write_text(json.dumps(receipt)); path.chmod(0o600)
                r = self.request(); normalized = self.validate(receipt) if project else None
                token = pilot.fingerprint(r, normalized)
                out = Path(tmp)/'out'
                args = ['--root', str(root), '--execute', '--output', str(out), '--request-fingerprint', token]
                if project:
                    args += ['--budget-mode', 'project', '--project-id', 'proj_test',
                             '--project-budget-confirmation', str(path)]
                client, sessions = fake_client(); client.project = 'proj_test'
                constructor = Mock(return_value=Context(client))
                with self.cli(args), patch.object(pilot, 'source_snapshot', return_value={p: b'# source\n' for p in pilot.ALLOWED_FILES}), \
                        patch.dict(pilot.sys.modules, {'openai': NS(OpenAI=constructor)}), \
                        patch.dict(pilot.os.environ, {'OPENAI_API_KEY': 'mock-test-key'}, clear=True), \
                        patch.object(pilot, 'execute', return_value={'status': 'mocked'}) as execute, \
                        patch.object(pilot.sys, 'stdout', io.StringIO()):
                    pilot.main()
                options = constructor.call_args.kwargs
                if project: self.assertEqual(options['project'], 'proj_test')
                else: self.assertNotIn('project', options)
                self.assertEqual(options['max_retries'], 0)
                execute.assert_called_once_with(client, r, out, token, project_budget=normalized)
                sessions.create.assert_not_called()


if __name__ == '__main__': unittest.main()
