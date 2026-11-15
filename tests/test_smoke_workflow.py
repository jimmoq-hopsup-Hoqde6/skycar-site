"""Offline contract tests: never use a real credential or network connection."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

WORKFLOW = Path(os.environ.get('SMOKE_WORKFLOW_PATH', '.github/workflows/skycar-openai-connection-test.yml'))
TEXT = WORKFLOW.read_text()
SHELL = textwrap.dedent(TEXT.split('        run: |\n', 1)[1])
CODE = SHELL.split("python3 - <<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
FAKE_KEY = 'FAKE_OFFLINE_KEY_DO_NOT_USE'

class SmokeWorkflowTest(unittest.TestCase):
    def execute(self, payload=None, error=None):
        calls = []
        output = io.StringIO()
        def fake_open(request, timeout):
            calls.append(request)
            self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
            self.assertEqual(timeout, 90)
            self.assertEqual(json.loads(request.data)['max_output_tokens'], 100)
            if error:
                raise error
            return io.BytesIO(payload)
        with tempfile.NamedTemporaryFile() as summary, patch.dict(os.environ, {'OPENAI_API_KEY': FAKE_KEY, 'GITHUB_STEP_SUMMARY': summary.name}), patch.object(urllib.request, 'urlopen', fake_open), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                exec(compile(CODE, 'smoke-workflow', 'exec'), {})
                result = None
            except SystemExit as exc:
                result = str(exc)
        self.assertEqual(len(calls), 1)
        self.assertNotIn(FAKE_KEY, output.getvalue() + (result or ''))
        return result

    def response(self, text):
        return json.dumps({'output': [{'content': [{'type': 'output_text', 'text': text}]}]}).encode()

    def test_static_controls(self):
        for control in ['workflow_dispatch:', 'permissions: {}', "if: github.ref == 'refs/heads/main' && github.run_attempt == 1", 'environment: skycar-agent-pilot', '${{ secrets.SKYCAR_OPENAI_SMOKE_KEY }}', 'timeout-minutes: 5']:
            self.assertIn(control, TEXT)
        self.assertNotIn('uses:', TEXT)
        self.assertNotIn('${{ secrets.OPENAI_API_KEY }}', TEXT)
        subprocess.run(['bash', '-n'], input=SHELL, text=True, check=True)

    def test_missing_key(self):
        result = subprocess.run(['bash', '-c', SHELL], env={'PATH': os.defpath}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SKYCAR_OPENAI_SMOKE_KEY is missing', result.stdout)

    def test_exact_marker(self):
        for value in ['SKYCAR_RUNNER_OK', ' \nSKYCAR_RUNNER_OK\n ']:
            with self.subTest(value=value):
                self.assertIsNone(self.execute(self.response(value)))

    def test_reject_embedded_or_missing_marker(self):
        for value in ['', 'NOT_SKYCAR_RUNNER_OK', 'SKYCAR_RUNNER_OK extra']:
            with self.subTest(value=value):
                self.assertIn('expected marker', self.execute(self.response(value)))

    def test_http_errors_only_include_status(self):
        for status in [401, 429, 500]:
            with self.subTest(status=status):
                error = urllib.error.HTTPError('https://api.openai.com/v1/responses', status, FAKE_KEY, {}, io.BytesIO(FAKE_KEY.encode()))
                self.assertEqual(self.execute(error=error), f'OpenAI connection test failed (HTTP {status}); check API billing/model access')

    def test_network_errors_are_sanitized(self):
        self.assertEqual(self.execute(error=urllib.error.URLError(FAKE_KEY)), 'OpenAI connection test failed (network or invalid response)')

    def test_invalid_response_is_sanitized(self):
        for value in [b'{', b'null', b'[]', b'{"output":null}', b'{"output":[{"content":[{"type":"output_text","text":123}]}]}']:
            with self.subTest(value=value):
                self.assertEqual(self.execute(value), 'OpenAI connection test failed (network or invalid response)')

if __name__ == '__main__':
    unittest.main()
