"""Validate a bounded candidate in a pinned, network-disabled, credential-free container."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import signal
import tempfile
import time
import uuid
from bounded_coding_pilot import PilotError, source_snapshot, validate_artifact
from technician_tasks import select, TEST_COMMAND, require_production_change
from executor_acceptance import CASES, challenges, verify_responses

IMAGE = 'node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54'
MAX_EVIDENCE_BYTES = 200_000
MAX_LOG_BYTES = 1_000_000


def bound_log():
    # Bound writes even if a hostile candidate exits before the polling loop runs.
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_LOG_BYTES, MAX_LOG_BYTES))


def read_json(path, maximum=MAX_EVIDENCE_BYTES):
    path = Path(path)
    # Downloader output is treated as hostile, including symlinked parent directories.
    if any(part.is_symlink() for part in (path, *path.parents)) or not path.is_file():
        raise PilotError("Evidence must be a regular non-symlink file")
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise PilotError("Evidence exceeds size limit")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise PilotError("Duplicate evidence JSON key")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise PilotError("Invalid evidence JSON") from None


def validate_run(root, sha, task_id, evidence, fingerprint, run_id):
    spec = select(task_id)
    original = source_snapshot(root, sha, task=spec)
    evidence = Path(evidence)
    state = read_json(evidence/'state.json')
    artifact = evidence/'changes.json'
    read_json(artifact)
    raw = artifact.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if (state.get('sha') != sha or state.get('task') != task_id
            or state.get('request_fingerprint') != fingerprint
            or state.get('status') != 'artifact_validated_NOT_TESTED'
            or state.get('cleanup') != 'deletion_requested'
            or state.get('session_visible_after_deletion') is not False
            or state.get('artifact_sha256') != digest):
        raise PilotError("Artifact does not match cleaned-up authorized coding run")
    files = validate_artifact(raw, task=spec)
    require_production_change(original, files)
    if all(content.encode() == original[path] for path, content in files.items()):
        raise PilotError("Task produced no code change")
    for content in files.values():
        if (not content.endswith('\n') or re.search(r'(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',content)):
            raise PilotError("Output violates text or credential-leak rules")
    if not re.fullmatch(r'[a-f0-9]{64}', fingerprint) or not re.fullmatch(r'\d+', run_id):
        raise PilotError("Invalid validation identity")
    return spec, original, files, digest


def docker_command(workspace, acceptance, name='skycar-validation-unit', command=TEST_COMMAND):
    return ['docker','run','--rm','--interactive','--name',name,'--log-driver','none','--network','none','--read-only','--cap-drop','ALL',
            '--security-opt','no-new-privileges','--pids-limit','64','--memory','512m',
            '--cpus','1','--ulimit','nofile=128:128','--user','65534:65534',
            '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=64m',
            '--mount',f'type=bind,source={workspace},target=/workspace,readonly',
            '--mount',f'type=bind,source={acceptance},target=/acceptance,readonly',
            '--workdir','/workspace',IMAGE,*command]


def run_container(workspace, acceptance, log, command, payload=b''):
    name = 'skycar-validation-' + uuid.uuid4().hex
    def cancelled(_signum, _frame):
        raise PilotError('Validation cancelled')
    handlers = {s: signal.signal(s, cancelled) for s in (signal.SIGTERM, signal.SIGINT)}
    process = None
    started = time.monotonic()
    try:
        with tempfile.TemporaryFile() as stdin, log.open('wb') as stdout:
            stdin.write(payload)
            stdin.seek(0)
            process = subprocess.Popen(docker_command(workspace, acceptance, name, command),
                stdin=stdin, stdout=stdout, stderr=subprocess.STDOUT,
                env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(workspace.parent)},
                preexec_fn=bound_log)
            try:
                while process.poll() is None:
                    if log.stat().st_size >= MAX_LOG_BYTES or time.monotonic()-started > 180:
                        raise PilotError('Candidate exceeded time/output bounds')
                    time.sleep(0.1)
                if process.returncode != 0 or log.stat().st_size >= MAX_LOG_BYTES:
                    raise PilotError('Candidate process failed')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
    finally:
        try:
            subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=20, check=False)
            # --rm may already have removed it. A daemon error is not evidence of absence.
            result = subprocess.run(['docker', 'container', 'ls', '--all', '--filter',
                'name=^/'+name+'$', '--format', '{{.ID}}'], capture_output=True, timeout=20, check=True)
            if result.stdout.strip():
                raise PilotError('Candidate container cleanup is unconfirmed')
        finally:
            for sig, handler in handlers.items(): signal.signal(sig, handler)


def validate(root, sha, task_id, evidence, fingerprint, run_id, output):
    spec, original, files, digest = validate_run(root,sha,task_id,evidence,fingerprint,run_id)
    output = Path(output)
    output.mkdir(exist_ok=False)
    acceptance = (Path(__file__).resolve().parent/'acceptance').resolve()
    subprocess.run(['docker','pull',IMAGE],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                   timeout=180)
    with tempfile.TemporaryDirectory(prefix='skycar-validation-') as tmp:
        workspace = Path(tmp)/'candidate'; workspace.mkdir(mode=0o755)
        Path(tmp).chmod(0o755)
        for path, raw in original.items():
            target = workspace/path; target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(raw); target.chmod(0o644)
        for path, content in files.items():
            (workspace/path).write_text(content,encoding='utf-8')
        unit_log, probe = output/'unit.log', output/'probe.json'
        run_container(workspace, acceptance, unit_log, TEST_COMMAND)
        expected = challenges()
        run_container(workspace, acceptance, probe, ('node', '/acceptance/technician-probe.mjs'),
                      json.dumps(expected).encode())
        # These assertions run in this trusted Python process, outside candidate execution.
        # Empty output, early exit, forged TAP/summary and missing cases cannot authorize a PR.
        passed = verify_responses(expected, read_json(probe))
        log = output/'tests.log'
        log.write_text(json.dumps(dict(passed, supervisor='external-v1',
            unit_log_sha256=hashlib.sha256(unit_log.read_bytes()).hexdigest()), sort_keys=True)+'\n')
        receipt = {'version':2,'task':spec.task_id,'sha':sha,'request_fingerprint':fingerprint,
                   'run_id':run_id,'artifact_sha256':digest,'status':'isolated_tests_passed',
                   'test_log_sha256':hashlib.sha256(log.read_bytes()).hexdigest(),
                   'supervisor':'external-v1','acceptance_cases':list(CASES),
                   'image':IMAGE,'network':'none','credentials':'none'}
    (output/'validation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


def verify_validation(receipt, task_id, sha, fingerprint, run_id, digest):
    fields={'version','task','sha','request_fingerprint','run_id','artifact_sha256','status',
            'test_log_sha256','image','network','credentials','supervisor','acceptance_cases'}
    if (type(receipt) is not dict or set(receipt)!=fields or type(receipt['version']) is not int
            or receipt['version']!=2 or receipt.get('supervisor')!='external-v1'
            or receipt.get('acceptance_cases')!=list(CASES) or receipt['task']!=task_id or receipt['sha']!=sha
            or receipt['request_fingerprint']!=fingerprint or receipt['run_id']!=run_id
            or receipt['artifact_sha256']!=digest or receipt['status']!='isolated_tests_passed'
            or receipt['image']!=IMAGE or receipt['network']!='none' or receipt['credentials']!='none'
            or not re.fullmatch(r'[a-f0-9]{64}',receipt['test_log_sha256'])):
        raise PilotError("Validation receipt does not match this exact candidate and run")
    return receipt
