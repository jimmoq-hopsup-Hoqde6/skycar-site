"""Reject candidate-controlled observations before execution and publication."""
import hashlib
import json
import shutil
import subprocess
import unittest
from unittest.mock import patch
import test_protected_executor as fixtures
from bounded_coding_pilot import PilotError
from executor_acceptance import CASES, challenges, verify_responses
from executor_pipeline import prepare, publish
from executor_validation import validate, validate_run
from technician_tasks import (ACCOUNT_GUARD, COMMAND_ANCHOR, PRODUCTION_PATH,
                              require_production_baseline, require_production_change)

NODE = shutil.which('node')

FORGERY = '''const realStringify = JSON.stringify;
JSON.stringify = function(value, ...rest) {
  if (value?.version === 1 && Array.isArray(value.responses)) {
    for (const response of value.responses) {
      if (response.case.endsWith(':different')) {
        response.status = 403;
        response.headers.account = null;
        response.body = {error: {code: 'FORBIDDEN'}};
      }
    }
  }
  return realStringify.call(this, value, ...rest);
};
'''

class ProductionIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.PipelineTests(); self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.original = {p: (self.f.root/p).read_bytes() for p in fixtures.TECHNICIAN.read_paths}

    def test_exact_guard_insertion_is_accepted(self):
        require_production_change(self.original, self.f.candidate())
        self.f.code()
        validate_run(self.f.root, self.f.sha, fixtures.TASK_ID,
                     self.f.evidence/'run', self.f.token, '123')

    def test_arbitrary_production_changes_and_observation_tampering_are_rejected(self):
        valid = self.f.candidate(); baseline = self.original[PRODUCTION_PATH].decode()
        changes = [baseline, FORGERY+baseline, 'process.exit(0);\n'+baseline,
                   'process.stdout.write = () => {};\n'+valid[PRODUCTION_PATH],
                   'Response.prototype.json = async () => ({});\n'+valid[PRODUCTION_PATH],
                   valid[PRODUCTION_PATH]+'// additional edit\n',
                   valid[PRODUCTION_PATH].replace('expectedAccount);', 'result.account);'),
                   valid[PRODUCTION_PATH].replace('\n', '\r\n')]
        for content in changes:
            with self.subTest(content=content[:60]), self.assertRaises(PilotError):
                require_production_change(self.original, dict(valid, **{PRODUCTION_PATH: content}))

    def test_changed_baseline_or_ambiguous_anchor_requires_new_review(self):
        for raw in (self.original[PRODUCTION_PATH]+b'\n',
                    self.original[PRODUCTION_PATH]+COMMAND_ANCHOR,
                    self.original[PRODUCTION_PATH].replace(COMMAND_ANCHOR, b''),
                    self.original[PRODUCTION_PATH].replace(COMMAND_ANCHOR, ACCOUNT_GUARD+COMMAND_ANCHOR)):
            with self.subTest(digest=hashlib.sha256(raw).hexdigest()), self.assertRaises(PilotError):
                require_production_baseline(dict(self.original, **{PRODUCTION_PATH: raw}))

    def test_changed_committed_baseline_blocks_preflight_before_inference(self):
        f = self.f
        with (f.root/PRODUCTION_PATH).open('ab') as stream: stream.write(b'\n')
        subprocess.run(['git','-C',str(f.root),'add','.'], check=True)
        subprocess.run(['git','-C',str(f.root),'-c','user.name=Unit','-c','user.email=unit@example.invalid',
                        'commit','-qm','changed baseline'], check=True)
        sha = fixtures.pilot.git(f.root,'rev-parse','HEAD').decode().strip()
        with self.assertRaises(PilotError): prepare(f.root,sha,fixtures.TASK_ID,'proj_test',500)

    def test_forgery_is_rejected_before_docker_or_publisher_writes(self):
        f = self.f; f.code(); path = f.evidence/'run/changes.json'
        artifact = json.loads(path.read_text())
        for item in artifact['files']:
            if item['path'] == PRODUCTION_PATH:
                item['content'] = FORGERY+self.original[PRODUCTION_PATH].decode()
        path.write_text(json.dumps(artifact)); digest = hashlib.sha256(path.read_bytes()).hexdigest()
        state_path = f.evidence/'run/state.json'
        state = json.loads(state_path.read_text()); state['artifact_sha256'] = digest
        state_path.write_text(json.dumps(state))
        parent, state = f.ledger.load()
        state['tasks'][fixtures.TASK_ID+'@'+f.sha]['artifact_sha256'] = digest
        f.ledger.save(parent, state); f.validation_receipt()
        with patch('executor_validation.subprocess.run', wraps=subprocess.run) as docker, self.assertRaises(PilotError):
            validate(f.root,f.sha,fixtures.TASK_ID,f.evidence/'run',f.token,'123',f.base/'rejected')
        self.assertFalse(any(call.args[0][0]=='docker' for call in docker.call_args_list))
        before = len(f.gh.calls)
        with self.assertRaises(PilotError):
            publish(f.root,f.sha,fixtures.TASK_ID,'proj_test',500,f.token,f.evidence,f.validation,f.gh,f.gh)
        self.assertFalse(any(method!='GET' for method,_,_ in f.gh.calls[before:]))
        self.assertEqual(f.gh.pulls,[])
        self.assertFalse(any(ref.startswith('heads/agent/') for ref in f.gh.refs))

    @unittest.skipUnless(NODE, 'Requires Node for exact probe reproduction')
    def test_actual_probe_can_be_forged_but_integrity_gate_rejects_it(self):
        f = self.f; source = f.root/PRODUCTION_PATH
        valid = f.candidate()
        source.write_text(FORGERY+self.original[PRODUCTION_PATH].decode())
        expected = challenges(); probe = fixtures.ROOT/'scripts/autonomy/acceptance/technician-probe.mjs'
        result = subprocess.run([NODE,str(probe)], input=json.dumps(expected),
            capture_output=True, text=True, timeout=20,
            env={'PATH': str(__import__('pathlib').Path(NODE).parent),
                 'SKYCAR_CANDIDATE_ROOT':str(f.root)})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(verify_responses(expected,json.loads(result.stdout))['cases_passed'],list(CASES))
        with self.assertRaises(PilotError):
            require_production_change(self.original,dict(valid,**{PRODUCTION_PATH:source.read_text()}))

if __name__ == '__main__': unittest.main()
