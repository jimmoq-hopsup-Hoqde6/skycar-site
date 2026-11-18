"""Fail closed before inference/publication unless generated-branch builds are suppressed."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
from bounded_coding_pilot import MAX_CENTS, PilotError, REPOSITORY, git

GUARD = "!startsWith(github.head_ref || github.ref_name, 'agent/')"
POLICY = 'scripts/autonomy/generated-build-policy.json'
OWNER_DECISION = 'D-009'
OWNER_CHECKLIST = {'unused_apps_suspended_or_uninstalled',
                   'preview_secrets_removed_and_tracking_off', 'dedicated_credentials_verified'}


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


def require_build_attestation(root, sha, now=None, *, context=None):
    digest = policy_digest(root, sha)
    raw = os.environ.get('SKYCAR_GENERATED_BUILD_ATTESTATION', '')
    if not raw or len(raw.encode()) > 4096:
        raise PilotError('Protected live build-security attestation is required')
    value = decode(raw)
    fields = {'version', 'repository', 'source_sha', 'policy_sha256', 'reviewer',
              'verified_at_utc', 'expires_at_utc', 'external_integrations_audited'}
    owner = type(value) is dict and value.get('attestation_type') == 'owner_risk_acceptance'
    if owner:
        fields |= {'attestation_type', 'independent_review', 'decision_id', 'run_id',
                   'project_id', 'task_id', 'budget_cents', 'request_fingerprint',
                   'draft_only', 'max_runs', 'checklist'}
    if (type(value) is not dict or set(value) != fields or type(value['version']) is not int
            or value['version'] != 1 or value['repository'] != REPOSITORY
            or value['source_sha'] != sha or value['policy_sha256'] != digest
            or value['external_integrations_audited'] is not True
            or not isinstance(value['reviewer'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', value['reviewer'])
            or (value['reviewer'].lower() == REPOSITORY.split('/')[0].lower()) != owner):
        raise PilotError('Build-security attestation does not match reviewed source or signer')
    if owner and (type(context) is not dict
            or set(context) != {'run_id', 'project_id', 'task_id', 'budget_cents', 'request_fingerprint'}
            or value['independent_review'] is not False or value['decision_id'] != OWNER_DECISION
            or value['draft_only'] is not True or type(value['max_runs']) is not int or value['max_runs'] != 1
            or type(value['budget_cents']) is not int or not 1 <= value['budget_cents'] <= MAX_CENTS
            or value['task_id'] != 'technician-command-account-v1'
            or not isinstance(value['run_id'], str) or not re.fullmatch(r'[1-9][0-9]*', value['run_id'])
            or not isinstance(value['project_id'], str) or not re.fullmatch(r'proj_[A-Za-z0-9]+', value['project_id'])
            or not isinstance(value['request_fingerprint'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', value['request_fingerprint'])
            or any(value[key] != expected or type(value[key]) is not type(expected)
                   for key, expected in context.items())
            or type(value['checklist']) is not dict or set(value['checklist']) != OWNER_CHECKLIST
            or any(answer is not True for answer in value['checklist'].values())):
        raise PilotError('Owner acceptance must authorize this one draft-only pilot and completed checklist')
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


def owner_acceptance_marker():
    """Call only after require_build_attestation validates the protected value."""
    value = decode(os.environ.get('SKYCAR_GENERATED_BUILD_ATTESTATION', ''))
    if value.get('attestation_type') != 'owner_risk_acceptance':
        return None
    return {'decision_id': OWNER_DECISION,
            'attestation_sha256': hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()}
