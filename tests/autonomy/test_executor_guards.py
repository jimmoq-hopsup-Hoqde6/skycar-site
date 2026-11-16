"""Regressions for independently supervised assertions and pre-publication build gates."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import test_protected_executor as fixtures
from executor_acceptance import CASES, challenges, verify_responses
from executor_build_guard import GUARD, POLICY, guarded_jobs, policy_digest, require_build_attestation
from executor_validation import run_container


def responses(expected):
    result = []
    for item in expected:
        same = item['expected_account'] == item['returned_account']
        result.append({'case':item['case'],'nonce':item['nonce'],
            'calls':[{'job':item['job'],'key':item['key'],'command':item['command'],
                      'expected':item['expected_account']}],
            'status':200 if same else 403,
            'headers':{'cache':'private, no-store','vary':'Cookie','account':item['expected_account'] if same else None},
            'body':{'data':item['result']} if same else {'error':{'code':'FORBIDDEN'}}})
    return {'version':1,'responses':result}


class SupervisorTests(unittest.TestCase):
    def test_all_eight_assertions_are_required_in_trusted_parent(self):
        expected = challenges()
        observed = responses(expected)
        self.assertEqual(verify_responses(expected, observed)['cases_passed'], list(CASES))
        self.assertNotEqual(expected, challenges())
        for bad in ({}, {'tests':17,'pass':17,'fail':0}, {'version':1,'responses':[]},
                    dict(observed,responses=observed['responses'][:-1])):
            with self.assertRaises(fixtures.pilot.PilotError):verify_responses(expected,bad)

    def test_unconfirmed_container_cleanup_fails_closed(self):
        import tempfile
        from unittest.mock import Mock
        process=Mock();process.poll.return_value=0;process.returncode=0
        for result in (subprocess.CompletedProcess([],0,stdout=b'still-running\n'),
                       subprocess.CalledProcessError(1,['docker','container','ls'])):
            with tempfile.TemporaryDirectory() as tmp,patch('executor_validation.subprocess.Popen',return_value=process), \
                    patch('executor_validation.subprocess.run',side_effect=[subprocess.CompletedProcess([],1),result]):
                with self.assertRaises((fixtures.pilot.PilotError,subprocess.CalledProcessError)):
                    run_container(Path(tmp),Path(tmp),Path(tmp)/'log',('node','unused'))

    def test_each_wrong_missing_or_replayed_response_fails(self):
        expected = challenges()
        for index in range(8):
            for field, value in (('status',0),('nonce','replayed'),('calls',[]),('body',{}),('headers',{})):
                with self.subTest(index=index,field=field):
                    bad=responses(expected);bad['responses'][index][field]=value
                    with self.assertRaises(fixtures.pilot.PilotError):verify_responses(expected,bad)

    def test_foreign_data_and_headers_cannot_pass_even_with_403(self):
        expected=challenges()
        for mutation in ('data','header'):
            bad=responses(expected);row=bad['responses'][1]
            if mutation=='data':row['body']['data']={}
            else:row['headers']['account']=expected[1]['returned_account']
            with self.assertRaises(fixtures.pilot.PilotError):verify_responses(expected,bad)


class BuildGuardTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.PipelineTests();self.f.setUp();self.addCleanup(self.f.doCleanups)

    def commit(self):
        subprocess.run(['git','-C',str(self.f.root),'add','.'],check=True)
        subprocess.run(['git','-C',str(self.f.root),'-c','user.name=Unit','-c','user.email=unit@example.invalid',
                        'commit','-qm','changed policy fixture'],check=True)
        return fixtures.pilot.git(self.f.root,'rev-parse','HEAD').decode().strip()

    def test_current_policy_has_all_job_guards_and_vercel_exclusion(self):
        digest=policy_digest(self.f.root,self.f.sha)
        self.assertEqual(require_build_attestation(self.f.root,self.f.sha),digest)
        for path in (self.f.root/'.github/workflows').glob('*'):guarded_jobs(path.read_bytes())

    def test_missing_wrong_expired_or_owner_attestation_blocks(self):
        now=datetime.now(timezone.utc)
        changes=({'source_sha':'f'*40},{'policy_sha256':'e'*64},{'reviewer':fixtures.pilot.REPOSITORY.split('/')[0]},
                 {'external_integrations_audited':False},{'version':True},
                 {'verified_at_utc':(now-timedelta(hours=2)).isoformat(),'expires_at_utc':(now-timedelta(hours=1)).isoformat()},
                 {'expires_at_utc':(now+timedelta(hours=25)).isoformat()})
        for change in changes:
            with self.subTest(change=change),patch.dict(os.environ,{'SKYCAR_GENERATED_BUILD_ATTESTATION':
                    fixtures.build_attestation(self.f.root,self.f.sha,**change)}):
                with self.assertRaises(fixtures.pilot.PilotError):require_build_attestation(self.f.root,self.f.sha)
        for raw in ('','{}','not json','{"version":1,"version":1}'):
            with patch.dict(os.environ,{'SKYCAR_GENERATED_BUILD_ATTESTATION':raw}):
                with self.assertRaises(fixtures.pilot.PilotError):require_build_attestation(self.f.root,self.f.sha)

    def test_changed_workflow_or_new_workflow_requires_policy_review(self):
        path=self.f.root/'.github/workflows/ci.yml'
        path.write_text(path.read_text().replace(GUARD,'true'))
        changed=self.commit()
        with self.assertRaises(fixtures.pilot.PilotError):policy_digest(self.f.root,changed)
        (self.f.root/'.github/workflows/unreviewed.yml').write_text('on: pull_request\njobs: {}\n')
        changed=self.commit()
        with self.assertRaises(fixtures.pilot.PilotError):policy_digest(self.f.root,changed)

    def test_missing_guard_or_vercel_true_cannot_be_reauthorized_by_updating_hash(self):
        path=self.f.root/'vercel.json'
        path.write_text('{"git":{"deploymentEnabled":true}}')
        policy_path=self.f.root/POLICY
        policy=json.loads(policy_path.read_text())
        import hashlib
        policy['files']['vercel.json']=hashlib.sha256(path.read_bytes()).hexdigest()
        policy_path.write_text(json.dumps(policy));changed=self.commit()
        with self.assertRaises(fixtures.pilot.PilotError):policy_digest(self.f.root,changed)
        with self.assertRaises(fixtures.pilot.PilotError):
            guarded_jobs(b'name: Bad\non: pull_request\njobs:\n  build:\n    runs-on: ubuntu-latest\n')


if __name__=='__main__':unittest.main()
