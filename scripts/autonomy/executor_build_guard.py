"""Fail closed before inference/publication unless generated-branch builds are suppressed."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
from bounded_coding_pilot import PilotError, REPOSITORY, git

GUARD = "!startsWith(github.head_ref || github.ref_name, 'agent/')"
POLICY = 'scripts/autonomy/generated-build-policy.json'


def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value: raise PilotError('Duplicate build-security evidence key')
            value[key] = item
        return value
    try: return json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError): raise PilotError('Invalid build-security evidence') from None


def source(root, sha, path):
    entry = git(root, 'ls-tree', sha, '--', path).decode().split()
    if len(entry) != 4 or entry[:2] != ['100644', 'blob']:
        raise PilotError('Build policy requires committed regular files')
    raw = git(root, 'show', sha+':'+path)
    if len(raw) > 256_000: raise PilotError('Build policy file exceeds bounds')
    return raw


def guarded_jobs(raw):
    text = raw.decode('utf-8')
    jobs = text.partition('\njobs:\n')[2]
    blocks = re.split(r'(?m)^  [A-Za-z0-9_-]+:\s*$', jobs)[1:]
    if not blocks: raise PilotError('No reviewed build jobs found')
    for block in blocks:
        conditions = re.findall(r'(?m)^    if: (.+)$', block)
        if len(conditions) != 1: raise PilotError('Every job must suppress generated branches')
        expression = decode(conditions[0])
        if not isinstance(expression, str) or not (expression == GUARD or expression.startswith(GUARD+' && (')):
            raise PilotError('Generated-branch job guard is missing')


def policy_digest(root, sha):
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or git(root, 'rev-parse', 'HEAD').decode().strip() != sha:
        raise PilotError('Build-policy source differs from approved source')
    policy = decode(source(root, sha, POLICY))
    if (type(policy) is not dict or set(policy) != {'version', 'repository', 'branch_prefix', 'files'}
            or type(policy['version']) is not int or policy['version'] != 1
            or policy['repository'] != REPOSITORY or policy['branch_prefix'] != 'agent/'
            or type(policy['files']) is not dict):
        raise PilotError('Invalid generated-build policy')
    workflows = git(root, 'ls-tree', '-r', '--name-only', sha, '--', '.github/workflows').decode().splitlines()
    expected = set(workflows) | {'vercel.json'}
    if not workflows or set(policy['files']) != expected:
        raise PilotError('New, missing or unreviewed workflow blocks publication')
    for path, digest in policy['files'].items():
        if not re.fullmatch(r'[a-f0-9]{64}', digest): raise PilotError('Invalid build-policy digest')
        raw = source(root, sha, path)
        if hashlib.sha256(raw).hexdigest() != digest:
            raise PilotError('Build configuration changed since policy review')
        if path != 'vercel.json': guarded_jobs(raw)
        elif json.dumps(decode(raw), sort_keys=True) != json.dumps({'git': {'deploymentEnabled': {'agent/**': False}}}, sort_keys=True):
            raise PilotError('Vercel generated-branch builds are not disabled')
    return hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest()


def require_build_attestation(root, sha, now=None):
    digest = policy_digest(root, sha)
    raw = os.environ.get('SKYCAR_GENERATED_BUILD_ATTESTATION', '')
    if not raw or len(raw.encode()) > 4096:
        raise PilotError('Independent live build-security attestation is required')
    value = decode(raw)
    fields = {'version', 'repository', 'source_sha', 'policy_sha256', 'reviewer',
              'verified_at_utc', 'expires_at_utc', 'external_integrations_audited'}
    if (type(value) is not dict or set(value) != fields or type(value['version']) is not int
            or value['version'] != 1 or value['repository'] != REPOSITORY
            or value['source_sha'] != sha or value['policy_sha256'] != digest
            or value['external_integrations_audited'] is not True
            or not isinstance(value['reviewer'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', value['reviewer'])
            or value['reviewer'].lower() == REPOSITORY.split('/')[0].lower()):
        raise PilotError('Build-security attestation does not match independent reviewed source')
    try:
        verified = datetime.fromisoformat(value['verified_at_utc'])
        expires = datetime.fromisoformat(value['expires_at_utc'])
        current = datetime.now(timezone.utc) if now is None else now
        if (verified.utcoffset() != timedelta(0) or expires.utcoffset() != timedelta(0)
                or not verified <= current < expires or not timedelta(0) < expires-verified <= timedelta(hours=24)):
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        raise PilotError('Build-security attestation is expired or invalid') from None
    return digest
