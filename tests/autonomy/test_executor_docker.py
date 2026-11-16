"""Real container acceptance; CI enables this without provider/GitHub credentials."""
import hashlib
import json
import os
from pathlib import Path
import unittest

import test_protected_executor as fixtures
from executor_validation import validate


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


if __name__ == '__main__':
    unittest.main()
