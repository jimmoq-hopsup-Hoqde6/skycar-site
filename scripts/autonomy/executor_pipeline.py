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
from executor_billing import ProviderBilling
from executor_github import GitHub, GitHubError, PREFIX
from executor_ledger import Ledger
from executor_validation import read_json, validate, validate_run, verify_validation
from technician_tasks import select, approved_issue


def prepare(root, sha, task_id, project, cents):
    spec = select(task_id)
    files = pilot.source_snapshot(root, sha, task=spec)
    request = pilot.build_request(files, sha, cents, task=spec)
    token = pilot.fingerprint(request, task=spec, provider_project_id=project)
    return spec, request, token


def workflow_context(sha, *, enabled=True):
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
    if not re.fullmatch(r'[a-f0-9]{64}',expected) or actual != expected:
        raise pilot.PilotError('Exact request fingerprint not approved')


def coding_run(root, sha, task_id, project, cents, token, output, github, coding_client, billing):
    spec, request, actual = prepare(root,sha,task_id,project,cents)
    require_approval(actual,token)
    run_id = workflow_context(sha)
    if github.main() != sha:
        raise pilot.PilotError('Approved source is no longer current main')
    github.environment()
    approved_issue(github.request('GET',PREFIX+'/issues/101'))
    billing.verify(project,cents)
    ledger = Ledger(github,project)
    output = Path(output)
    output.mkdir(exist_ok=False,mode=0o700)
    key = ledger.claim(task_id,sha,token,cents,run_id)
    approval = {'task':task_id,'sha':sha,'project_id':project,'budget_cents':cents,
                'request_fingerprint':token,'run_id':run_id,'ledger_key':key}
    pilot.write_json(output/'approval.json',approval)
    state = pilot.execute(coding_client,request,output/'run',token,task=spec,
                          budget_verifier=billing.verify,provider_project_id=project)
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
    state['post_run_provider_budget'] = billing.verify(project,cents)
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
                   'The scoped Node tests and fixed operator acceptance passed in a pinned '
                   'network-disabled container without credentials. Full application CI and '
                   'independent QA/security review remain required. No approval, merge, live '
                   'migration or production promotion is authorized by this draft. '
                   'Existing repository Git integrations may build a preview automatically.'})
    if type(pr.get('number')) is not int or pr.get('draft') is not True:
        raise pilot.PilotError('GitHub did not confirm draft-only publication')
    ledger.advance(key,token,run_id,'publishing','published',draft_pr=pr['number'])
    return {'status':'draft_pr_created_NOT_APPROVED','pr':pr['number'],'sha':sha,'artifact_sha256':digest}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=('preflight','initialize-ledger','execute','validate','publish'))
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
        elif args.operation=='execute':
            require_approval(token,args.approved_fingerprint)
            workflow_context(args.sha)
            # Imports/dependency install happen before injecting credentials in the workflow.
            from openai import OpenAI
            org=os.environ.get('SKYCAR_OPENAI_ORGANIZATION_ID','')
            if not re.fullmatch(r'org-[A-Za-z0-9]+',org):
                raise pilot.PilotError('Selected organization is missing')
            coding_key=os.environ.get('SKYCAR_OPENAI_CODING_KEY')
            billing_key=os.environ.get('SKYCAR_OPENAI_BILLING_READ_KEY')
            if not coding_key or not billing_key:
                raise pilot.PilotError('Dedicated coding and billing-read credentials required')
            with OpenAI(admin_api_key=billing_key,organization=org,base_url='https://api.openai.com/v1',
                        max_retries=0,timeout=20) as admin, \
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
                          'failure':pilot.failure_details(exc,'protected_executor')}),file=sys.stderr)
        raise SystemExit(1) from None


if __name__=='__main__':main()
