"""Real container acceptance; CI enables this without provider/GitHub credentials."""
import hashlib
import json
import os
from pathlib import Path
import unittest

import test_protected_executor as fixtures
from executor_validation import validate
from executor_pipeline import publish
from executor_acceptance import CASES


@unittest.skipUnless(os.environ.get('SKYCAR_DOCKER_TESTS') == '1', 'Requires Docker integration job')
class DockerAcceptance(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PipelineTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.code()

    def run_candidate(self, output):
        f = self.fixture
        return validate(f.root, f.sha, fixtures.TASK_ID, f.evidence/'run', f.token, '123', output)

    def test_valid_fix_passes_real_isolated_node_tests(self):
        result = self.run_candidate(self.fixture.base/'docker-valid')
        self.assertEqual(result['status'], 'isolated_tests_passed')
        self.assertEqual(result['network'], 'none')
        self.assertEqual(result['credentials'], 'none')
        self.assertEqual(result['acceptance_cases'], list(CASES))

    def test_unchanged_vulnerability_fails_independent_acceptance(self):
        f = self.fixture
        path = f.evidence/'run/changes.json'
        artifact = json.loads(path.read_text())
        for entry in artifact['files']:
            entry['content'] = (f.root/entry['path']).read_text() + '\n// deliberately ineffective fixture change\n'
        path.write_text(json.dumps(artifact))
        state_path = f.evidence/'run/state.json'
        state = json.loads(state_path.read_text())
        state['artifact_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        state_path.write_text(json.dumps(state))
        with self.assertRaises(fixtures.pilot.PilotError):
            self.run_candidate(f.base/'docker-invalid')
        self.assertFalse((f.base/'docker-invalid/validation.json').exists())

    def early_exit_candidate(self, prefix):
        f = self.fixture
        path = f.evidence/'run/changes.json'
        artifact = json.loads(path.read_text())
        for entry in artifact['files']:
            entry['content'] = (f.root/entry['path']).read_text()
            if entry['path'] == 'src/server/technician/http.mjs':
                entry['content'] = prefix + '\n' + entry['content']
        path.write_text(json.dumps(artifact))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        state_path = f.evidence/'run/state.json'
        state = json.loads(state_path.read_text()); state['artifact_sha256'] = digest
        state_path.write_text(json.dumps(state))
        parent, state = f.ledger.load()
        state['tasks'][fixtures.TASK_ID+'@'+f.sha]['artifact_sha256'] = digest
        f.ledger.save(parent, state)
        output = f.base/'docker-early-exit'
        with self.assertRaises(fixtures.pilot.PilotError): self.run_candidate(output)
        self.assertFalse((output/'validation.json').exists())
        with self.assertRaises(fixtures.pilot.PilotError):
            publish(f.root,f.sha,fixtures.TASK_ID,'proj_test',500,f.token,f.evidence,output,f.gh,f.gh)
        self.assertEqual(f.gh.pulls, [])
        self.assertFalse(any(ref.startswith('heads/agent/') for ref in f.gh.refs))

    def test_zero_exit_without_assertions_cannot_publish(self):
        self.early_exit_candidate('process.exit(0);')

    def test_serialization_forgery_cannot_execute_or_publish(self):
        from test_production_integrity import FORGERY
        self.early_exit_candidate(FORGERY)

    def test_forged_passing_summary_cannot_publish(self):
        self.early_exit_candidate('console.log("TAP version 13\\n1..17\\n# pass 17\\n# fail 0"); process.exit(0);')


if __name__ == '__main__':
    unittest.main()
