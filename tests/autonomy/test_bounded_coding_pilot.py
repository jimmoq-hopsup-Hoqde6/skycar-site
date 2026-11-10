import base64
import copy
import importlib.util
import json
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
        for n in (0, -1, 101, True, 1.5):
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


if __name__ == '__main__': unittest.main()
