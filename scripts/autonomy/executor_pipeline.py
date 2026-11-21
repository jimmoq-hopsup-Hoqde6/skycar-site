#!/usr/bin/env python3
"""Reviewed one-task pipeline. Default is offline preflight; no issue polling or schedule."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse
import bounded_coding_pilot as pilot
from executor_diagnostics import diagnostic_gate, safe_failure
from executor_billing import ProviderBilling
from executor_github import GitHub, GitHubError, PREFIX
from executor_ledger import Ledger
from executor_build_guard import policy_digest, require_build_attestation, owner_acceptance_marker
from executor_validation import read_json, validate, validate_run, verify_validation
from technician_tasks import select, approved_issue, require_production_baseline


# Only the read-only Admin client uses bounded SDK retries.
BILLING_READ_RETRIES = 3

def prepare(root, sha, task_id, project, cents):
    with diagnostic_gate('source_request'):
        spec = select(task_id)
        files = pilot.source_snapshot(root, sha, task=spec)
        require_production_baseline(files)
        request = pilot.build_request(files, sha, cents, task=spec)
        token = pilot.fingerprint(request, task=spec, provider_project_id=project)
        return spec, request, token


def workflow_context(sha, *, enabled=True):
    with diagnostic_gate('workflow_context'):
        if (os.environ.get('GITHUB_REPOSITORY') != pilot.REPOSITORY
                or os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
                or os.environ.get('GITHUB_REF') != 'refs/heads/main'
                or os.environ.get('GITHUB_SHA') != sha
                or os.environ.get('GITHUB_RUN_ATTEMPT') != '1'
                or not re.fullmatch(r'\d+',os.environ.get('GITHUB_RUN_ID',''))
                or enabled and os.environ.get('SKYCAR_EXECUTOR_ENABLED') != 'true'):
            raise pilot.PilotError('Execution context, first-attempt or stop-switch gate blocked')
        return os.environ['GITHUB_RUN_ID']


def require_approval(actual, expected):
    with diagnostic_gate('approval_fingerprint'):
        if not re.fullmatch(r'[a-f0-9]{64}',expected) or actual != expected:
            raise pilot.PilotError('Exact request fingerprint not approved')


def build_authorization(root, sha, task_id, project, cents, token, run_id):
    with diagnostic_gate('build_acceptance'):
        require_build_attestation(root, sha, context={
            'task_id': task_id, 'project_id': project, 'budget_cents': cents,
            'request_fingerprint': token, 'run_id': run_id})
        return owner_acceptance_marker()


def verify_billing_only(sha, project, cents, github, billing):
    # No coding client, ledger, acceptance mutation or publication on this path.
    workflow_context(sha, enabled=False)
    with diagnostic_gate('current_main'):
        if github.main() != sha:
            raise pilot.PilotError('Approved source is no longer current main')
    with diagnostic_gate('environment_protection'):
        github.environment()
    with diagnostic_gate('billing_verification'):
        proof = billing.verify(project, cents, require_headroom=False)
    return {'status': 'billing_verified_NO_CODING', 'sha': sha, 'proof': proof,
            'remaining_headroom_cents': proof['limit_cents'] - proof['observed_spend_cents'],
            'full_request_fits': proof['observed_spend_cents'] + cents <= proof['limit_cents']}


def verify_coding_key(client):
    # Free authenticated read with the dedicated coding key; no model input or spend.
    with diagnostic_gate('coding_key'):
        model = client.models.retrieve(pilot.MODEL)
        if getattr(model, 'id', None) != pilot.MODEL:
            raise pilot.PilotError('Coding key cannot read the reviewed model')
    return 'authenticated'


FAILED_CONCLUSIONS = ('failure', 'cancelled', 'timed_out')


def failed_run_session(evidence, entry):
    """The failed run's own uploaded state.json is the only session-id source."""
    with diagnostic_gate('failed_run_evidence'):
        path = Path(evidence) / 'run' / 'state.json'
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 1_000_000:
            raise pilot.PilotError('Failed-run evidence is missing')
        state = json.loads(path.read_text(encoding='utf-8'))
        session_id = state.get('session_id') if type(state) is dict else None
        if (state.get('request_fingerprint') != entry['fingerprint']
                or state.get('sha') != entry_sha(entry)
                or not isinstance(session_id, str) or not re.fullmatch(r'sess_[A-Za-z0-9]+', session_id)):
            # No known session id (for example an unknown creation outcome) cannot be released.
            raise pilot.PilotError('Failed-run evidence does not identify this reservation and session')
        return session_id


def entry_sha(entry):
    return entry['_key'].rsplit('@', 1)[1]


def ensure_session_absent(client, session_id):
    """Release only after this credential has SEEN the session, deleted it, then got 404.

    A provider 404 also means "not visible to this request" (wrong project or a
    restricted/rotated credential), so an initial 404 proves nothing. Seeing the
    session first is the provider-backed proof that this credential is scoped to
    its project; after that, a 404 means it is gone. Otherwise the lock stays and
    the owner must reconcile in the provider dashboard."""
    def missing():
        try:
            client.beta.agents.sessions.retrieve(session_id)
        except Exception as exc:
            if getattr(exc, 'status_code', None) == 404:
                return True
            raise
        return False
    with diagnostic_gate('session_absence'):
        if missing():
            raise pilot.PilotError('Session not visible to this credential (ambiguous 404); '
                                   'keep the lock and reconcile in the provider dashboard')
        try:
            client.beta.agents.sessions.events.create(
                session_id, events=[{'type': 'agent.session.input.cancel'}])
        except Exception:
            pass  # Deletion and the 404 check below are authoritative.
        for attempt in range(3):
            try:
                client.beta.agents.sessions.delete(session_id)
                break
            except Exception as exc:
                if getattr(exc, 'status_code', None) == 404:
                    break
                if getattr(exc, 'status_code', None) != 409 or attempt == 2:
                    raise
                time.sleep(2)
        if not missing():
            raise pilot.PilotError('Provider session still exists; do not release')
        return True


def release_failed_reservation(sha, project, failed_run_id, github, billing, coding_client, evidence):
    """Owner-approved, protected: free the lease of one failed pre-artifact run.

    The task record, its owner acceptance and its reserved budget stay in the
    ledger. A new attempt needs a new source SHA and an owner acceptance that
    names this run in supersedes_run_id."""
    run_id = workflow_context(sha, enabled=False)
    with diagnostic_gate('current_main'):
        if github.main() != sha:
            raise pilot.PilotError('Approved source is no longer current main')
    with diagnostic_gate('environment_protection'):
        github.environment()
    with diagnostic_gate('failed_run'):
        if not re.fullmatch(r'[1-9][0-9]*', failed_run_id or '') or failed_run_id == run_id:
            raise pilot.PilotError('A different, exact failed run is required')
        run = github.request('GET', PREFIX + '/actions/runs/' + failed_run_id)
        if (str(run.get('id')) != failed_run_id or run.get('status') != 'completed'
                or run.get('conclusion') not in FAILED_CONCLUSIONS
                or run.get('path') != '.github/workflows/skycar-technician-executor.yml'
                or run.get('event') != 'workflow_dispatch' or run.get('head_branch') != 'main'):
            raise pilot.PilotError('Run is not a completed, failed technician executor run')
    ledger = Ledger(github, project)
    with diagnostic_gate('ledger_release'):
        _, state = ledger.load()
        key = state['active']
        entry = state['tasks'].get(key) if key else None
        if entry is None or entry['phase'] != 'reserved' or entry['run_id'] != failed_run_id:
            raise pilot.PilotError('Only the active pre-artifact reservation of that run can be released')
    session_id = failed_run_session(evidence, dict(entry, _key=key))
    session_absent = ensure_session_absent(coding_client, session_id)
    # Billing is read after the session is confirmed gone, so no turn can still be accruing.
    with diagnostic_gate('billing_verification'):
        proof = billing.verify(project, 1, False)
    release = {'released_by_run_id': run_id, 'failed_run_conclusion': run['conclusion'],
               'observed_spend_cents': proof['observed_spend_cents'],
               'limit_cents': proof['limit_cents'], 'verified_at_utc': proof['verified_at_utc'],
               'session_id': session_id, 'session_absent_confirmed': session_absent}
    with diagnostic_gate('ledger_release'):
        key = ledger.release(failed_run_id, release)
    return {'status': 'reservation_released_RECORD_KEPT', 'task': key, 'failed_run_id': failed_run_id,
            'session_id': session_id, 'session_absent_confirmed': True,
            'observed_spend_cents': proof['observed_spend_cents'],
            'remaining_headroom_cents': proof['limit_cents'] - proof['observed_spend_cents']}


def require_full_budget_headroom(proof, cents):
    # A nominal project cap does not reserve the full per-run budget when prior
    # project usage exists. Check before any ledger claim, session or model input.
    # Post-run billing intentionally only verifies actual observed spend.
    if proof['observed_spend_cents'] + cents > proof['limit_cents']:
        failure = pilot.PilotError('Insufficient provider hard-limit headroom for requested budget')
        failure._skycar_billing_reason = 'headroom'
        raise failure
    return proof


def coding_run(root, sha, task_id, project, cents, token, output, github, coding_client, billing):
    spec, request, actual = prepare(root,sha,task_id,project,cents)
    require_approval(actual,token)
    run_id = workflow_context(sha)
    with diagnostic_gate('current_main'):
        if github.main() != sha:
            raise pilot.PilotError('Approved source is no longer current main')
    with diagnostic_gate('environment_protection'):
        github.environment()
    with diagnostic_gate('issue_approval'):
        approved_issue(github.request('GET',PREFIX+'/issues/101'))
    with diagnostic_gate('build_acceptance'):
        acceptance = build_authorization(root, sha, task_id, project, cents, token, run_id)
    with diagnostic_gate('billing_verification'):
        require_full_budget_headroom(billing.verify(project,cents), cents)
    with diagnostic_gate('ledger_reservation'):
        ledger = Ledger(github,project)
        output = Path(output)
        output.mkdir(exist_ok=False,mode=0o700)
        key = ledger.claim(task_id,sha,token,cents,run_id,owner_acceptance=acceptance)
    approval = {'task':task_id,'sha':sha,'project_id':project,'budget_cents':cents,
                'request_fingerprint':token,'run_id':run_id,'ledger_key':key}
    pilot.write_json(output/'approval.json',approval)
    def verified_budget(selected_project, requested):
        if build_authorization(root, sha, task_id, selected_project, requested, token, run_id) != acceptance:
            raise pilot.PilotError('Build authorization changed after durable reservation')
        return require_full_budget_headroom(billing.verify(selected_project, requested), requested)
    with diagnostic_gate('coding_session'):
        state = pilot.execute(coding_client,request,output/'run',token,task=spec,
                              budget_verifier=verified_budget,provider_project_id=project)
    with diagnostic_gate('session_cleanup'):
        visible = True
        for attempt in range(3):
            try:
                coding_client.beta.agents.sessions.retrieve(state['session_id'])
            except Exception as exc:
                if getattr(exc,'status_code',None) != 404:
                    raise
                visible = False
                break
            if attempt < 2:
                time.sleep(2)
        if visible:
            raise pilot.PilotError('Session deletion not confirmed; lease remains blocked')
        state['session_visible_after_deletion'] = False
    with diagnostic_gate('post_run_billing'):
        state['post_run_provider_budget'] = billing.verify(project,cents,False)
    with diagnostic_gate('ledger_advance'):
        pilot.write_json(output/'run/state.json',state)
        ledger.advance(key,token,run_id,'reserved','coded',artifact_sha256=state['artifact_sha256'],
                       session_id=state['session_id'],observed_spend_cents=state['post_run_provider_budget']['observed_spend_cents'])
    return {'status':'coded_NOT_TESTED','sha':sha,'task':task_id,'artifact_sha256':state['artifact_sha256']}


def publish(root, sha, task_id, project, cents, token, evidence, validation, github, ledger_github):
    spec, request, actual = prepare(root,sha,task_id,project,cents)
    require_approval(actual,token)
    run_id = workflow_context(sha)
    if ledger_github.main() != sha:
        raise pilot.PilotError('Main advanced; do not silently rebase an approved task')
    ledger_github.environment()
    approved_issue(ledger_github.request('GET',PREFIX+'/issues/101'))
    acceptance = build_authorization(root, sha, task_id, project, cents, token, run_id)
    _, _, files, digest = validate_run(root,sha,task_id,Path(evidence)/'run',token,run_id)
    receipt = read_json(Path(validation)/'validation.json',4096)
    verify_validation(receipt,task_id,sha,token,run_id,digest)
    log=Path(validation)/'tests.log'
    if (any(p.is_symlink() for p in (log,*log.parents)) or not log.is_file()
            or log.stat().st_size>1_000_000 or hashlib.sha256(log.read_bytes()).hexdigest()!=receipt['test_log_sha256']):
        raise pilot.PilotError('Validation log differs from the isolated test evidence')
    # Publisher never imports or executes candidate files. Only the registry selects paths.
    ledger = Ledger(ledger_github,project)
    key = task_id+'@'+sha
    _, _, entry = ledger.entry(key,token,run_id)
    if entry.get('owner_risk_acceptance') != acceptance:
        raise pilot.PilotError('Publication authorization differs from the durable reservation')
    if entry.get('artifact_sha256') != digest:
        raise pilot.PilotError('Candidate differs from durable coding evidence')
    branch = 'agent/'+task_id+'/'+sha[:12]
    if entry['phase'] == 'coded':
        commit = github.commit_files(sha,files,'AI draft: technician command account precondition')
        ledger.advance(key,token,run_id,'coded','publishing',candidate_commit=commit,
                       validation_sha256=hashlib.sha256(json.dumps(receipt,sort_keys=True).encode()).hexdigest())
    elif entry['phase'] != 'publishing':
        raise pilot.PilotError('Publication phase is not recoverable without reconciliation')
    _, _, entry = ledger.entry(key,token,run_id)
    commit = entry['candidate_commit']
    try:
        existing = github.request('GET',PREFIX+'/git/ref/heads/'+branch)
    except GitHubError as exc:
        if exc.status_code != 404:
            raise
        if build_authorization(root, sha, task_id, project, cents, token, run_id) != acceptance:
            raise pilot.PilotError('Build authorization changed before branch creation')
        github.request('POST',PREFIX+'/git/refs',{'ref':'refs/heads/'+branch,'sha':commit})
    else:
        if existing.get('object',{}).get('sha') != commit:
            raise pilot.PilotError('Publisher branch exists with different content')
    head = urllib.parse.quote(pilot.REPOSITORY.split('/')[0]+':'+branch,safe='')
    pulls = github.request('GET',PREFIX+'/pulls?state=all&head='+head)
    if type(pulls) is not list or len(pulls)>1:
        raise pilot.PilotError('Ambiguous publisher PR state')
    if pulls:
        pr = pulls[0]
        if (pr.get('draft') is not True or pr.get('state') != 'open'
                or pr.get('head',{}).get('sha') != commit or pr.get('base',{}).get('ref') != 'main'):
            raise pilot.PilotError('Existing PR does not match this unpublished draft')
    else:
        if ledger_github.main()!=sha:
            raise pilot.PilotError('Main advanced during publication')
        pr = github.request('POST',PREFIX+'/pulls',{
            'title':'[AI draft] Validate technician command response account',
            'head':branch,'base':'main','draft':True,'maintainer_can_modify':False,
            'body':f'Bounded AI task `{task_id}` for #101.\n\nBase: `{sha}`. '
                   f'Artifact SHA-256: `{digest}`.\n\n'
                   + ('Build risk accepted by Marcel (@jimmoq-hopsup-Hoqde6) under D-009; '
                      'owner_risk_acceptance, independent_review=false. One supervised pilot only.\n\n'
                      if acceptance is not None else '') +
                   'The scoped Node tests and fixed operator acceptance passed in a pinned '
                   'network-disabled container without credentials. Full application CI and '
                   'independent QA/security review remain required. No approval, merge, live '
                   'migration or production promotion is authorized by this draft. '
                   'Automatic generated-branch jobs and Vercel previews are suppressed by the '
                   'reviewed build policy. Run full application CI on independently reviewed code '
                   'before considering a merge.'})
    if type(pr.get('number')) is not int or pr.get('draft') is not True:
        raise pilot.PilotError('GitHub did not confirm draft-only publication')
    ledger.advance(key,token,run_id,'publishing','published',draft_pr=pr['number'])
    return {'status':'draft_pr_created_NOT_APPROVED','pr':pr['number'],'sha':sha,'artifact_sha256':digest}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=('preflight','initialize-ledger','verify-billing','release-reservation',
                                             'execute','validate','publish'))
    parser.add_argument('--release-run-id',default='')
    parser.add_argument('--root',type=Path,default=Path.cwd())
    parser.add_argument('--sha',required=True)
    parser.add_argument('--task',default='technician-command-account-v1')
    parser.add_argument('--project-id',required=True)
    parser.add_argument('--budget-cents',type=int,default=500)
    parser.add_argument('--approved-fingerprint',default='')
    parser.add_argument('--evidence',type=Path)
    parser.add_argument('--validation',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:
        spec, request, token=prepare(args.root,args.sha,args.task,args.project_id,args.budget_cents)
        if args.operation=='preflight':
            result={'status':'offline_preflight_NOT_AUTHORIZED','sha':args.sha,'task':spec.task_id,
                    'project_id':args.project_id,'budget_cents':args.budget_cents,'request_fingerprint':token,
                    'read_paths':spec.read_paths,'write_paths':spec.write_paths,
                    'build_policy_sha256':policy_digest(args.root,args.sha),
                    'publication':'Requires current independent attestation or one-run owner risk acceptance (D-009)',
                    'billing':'Live provider hard-limit/cost verification required before execution'}
        elif args.operation=='validate':
            require_approval(token,args.approved_fingerprint)
            result=validate(args.root,args.sha,args.task,args.evidence/'run',token,
                            os.environ.get('GITHUB_RUN_ID',''),args.output)
        elif args.operation=='initialize-ledger':
            workflow_context(args.sha,enabled=False)
            gh=GitHub(os.environ.get('GH_TOKEN'))
            gh.environment()
            if gh.main()!=args.sha:raise pilot.PilotError('Main advanced')
            Ledger(gh,args.project_id).initialize()
            result={'status':'ledger_initialized_NOT_ACTIVE'}
        elif args.operation=='verify-billing':
            workflow_context(args.sha, enabled=False)
            with diagnostic_gate('coding_key'):
                # The documented check is billing AND coding key; never report success without both.
                if not os.environ.get('SKYCAR_OPENAI_CODING_KEY'):
                    raise pilot.PilotError('Coding credential required for the billing-and-key check')
            with diagnostic_gate('credentials'):
                from openai import OpenAI
                org = os.environ.get('SKYCAR_OPENAI_ORGANIZATION_ID', '')
                key = os.environ.get('SKYCAR_OPENAI_BILLING_READ_KEY')
                if not re.fullmatch(r'org-[A-Za-z0-9]+', org) or not key:
                    raise pilot.PilotError('Selected organization and billing-read credential required')
                with OpenAI(admin_api_key=key, organization=org, base_url='https://api.openai.com/v1',
                            max_retries=BILLING_READ_RETRIES, timeout=20) as admin:
                    result = verify_billing_only(args.sha, args.project_id, args.budget_cents,
                        GitHub(os.environ.get('GH_TOKEN')), ProviderBilling(admin))
                with OpenAI(api_key=os.environ['SKYCAR_OPENAI_CODING_KEY'], project=args.project_id,
                            organization=org, base_url='https://api.openai.com/v1',
                            max_retries=2, timeout=20) as coder:
                    result['coding_key'] = verify_coding_key(coder)
        elif args.operation=='release-reservation':
            with diagnostic_gate('credentials'):
                from openai import OpenAI
                org = os.environ.get('SKYCAR_OPENAI_ORGANIZATION_ID', '')
                key = os.environ.get('SKYCAR_OPENAI_BILLING_READ_KEY')
                coding_key = os.environ.get('SKYCAR_OPENAI_CODING_KEY')
                if not re.fullmatch(r'org-[A-Za-z0-9]+', org) or not key or not coding_key or not args.evidence:
                    raise pilot.PilotError('Organization, billing-read and coding credentials and evidence required')
                # Coding client: session retrieve/cancel/delete only; never creates sessions or turns.
                with OpenAI(admin_api_key=key, organization=org, base_url='https://api.openai.com/v1',
                            max_retries=BILLING_READ_RETRIES, timeout=20) as admin, \
                     OpenAI(api_key=coding_key, project=args.project_id, organization=org,
                            base_url='https://api.openai.com/v1', max_retries=0, timeout=30) as coder:
                    result = release_failed_reservation(args.sha, args.project_id, args.release_run_id,
                        GitHub(os.environ.get('GH_TOKEN')), ProviderBilling(admin), coder, args.evidence)
        elif args.operation=='execute':
            require_approval(token,args.approved_fingerprint)
            workflow_context(args.sha)
            # Imports/dependency install happen before injecting credentials in the workflow.
            with diagnostic_gate('credentials'):
                from openai import OpenAI
                org=os.environ.get('SKYCAR_OPENAI_ORGANIZATION_ID','')
                if not re.fullmatch(r'org-[A-Za-z0-9]+',org):
                    raise pilot.PilotError('Selected organization is missing')
                coding_key=os.environ.get('SKYCAR_OPENAI_CODING_KEY')
                billing_key=os.environ.get('SKYCAR_OPENAI_BILLING_READ_KEY')
                if not coding_key or not billing_key:
                    raise pilot.PilotError('Dedicated coding and billing-read credentials required')
                with OpenAI(admin_api_key=billing_key,organization=org,base_url='https://api.openai.com/v1',
                            max_retries=BILLING_READ_RETRIES,timeout=20) as admin, \
                     OpenAI(api_key=coding_key,project=args.project_id,organization=org,
                            base_url='https://api.openai.com/v1',max_retries=0,timeout=60) as client:
                    result=coding_run(args.root,args.sha,args.task,args.project_id,args.budget_cents,token,
                                      args.output,GitHub(os.environ.get('GH_TOKEN')),client,ProviderBilling(admin))
        else:
            result=publish(args.root,args.sha,args.task,args.project_id,args.budget_cents,
                           args.approved_fingerprint,args.evidence,args.validation,
                           GitHub(os.environ.get('SKYCAR_PR_PUBLISHER_TOKEN')),
                           GitHub(os.environ.get('GH_TOKEN')))
        print(json.dumps(result,sort_keys=True))
    except BaseException as exc:
        # No raw exception/body, candidate output, URLs or credentials in diagnostics.
        print(json.dumps({'status':'blocked_RECONCILE_BEFORE_RETRY',
                          'failure':safe_failure(exc)}),file=sys.stderr)
        raise SystemExit(1) from None


if __name__=='__main__':main()
