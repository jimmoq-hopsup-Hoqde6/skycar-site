"""Real pinned SDK, mocked HTTP transport. No credentials or network required."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
try:
    from openai import OpenAI
    import httpx2
except ImportError:
    OpenAI = None

spec=importlib.util.spec_from_file_location('pilot',Path(__file__).resolve().parents[2]/'scripts/autonomy/bounded_coding_pilot.py')
pilot=importlib.util.module_from_spec(spec);spec.loader.exec_module(pilot)


@unittest.skipIf(OpenAI is None, 'Install scripts/autonomy/requirements-pilot.txt for SDK contract tests')
class SDKContractTests(unittest.TestCase):
    def exercise(self, failed=False):
        requests=[]
        session={'id':'sess_contract','object':'agent.session','created_at':0,'last_active_at':0,
                 'agent':{'model':pilot.MODEL},'environment':{'type':'openai_hosted','id':'env_contract'},
                 'metadata':{},'required_actions':[],'status':'idle','vault_ids':[],
                 'spend_control':{'limit':100,'consumed':0}}
        turn={'id':'turn_contract','object':'agent.session.turn','session_id':session['id'],
              'agent_id':'agent_contract','created_at':0,'subagent_id':None,'status':'in_progress'}
        def handle(req):
            requests.append((req.method,req.url.path,req.content))
            path=req.url.path
            if path.endswith('/events') and req.method=='GET':
                end='failed' if failed else 'completed'
                events=[{'type':'agent.session.turn.created','event_id':'ev1','session_id':session['id'],'turn_id':turn['id'],'turn':turn},
                        {'type':'agent.session.turn.'+end,'event_id':'ev2','session_id':session['id'],'turn_id':turn['id'],'turn':dict(turn,status=end)},
                        {'type':'agent.session.idle','event_id':'ev3','session':session}]
                raw=''.join('data: '+json.dumps(e)+'\n\n' for e in events)
                return httpx2.Response(200,headers={'content-type':'text/event-stream'},content=raw)
            if path.endswith('/events'):
                return httpx2.Response(200,json={})
            if path.endswith('/environments/env_contract'):
                return httpx2.Response(200,json={'id':'env_contract','type':'openai_hosted','status':'connected'})
            if path.endswith('/artifacts/art_contract/content'):
                return httpx2.Response(200,content=json.dumps({'task_id':pilot.TASK_ID,'files':[{'path':p,'content':'# candidate\n'} for p in pilot.ALLOWED_FILES]}).encode())
            if path.endswith('/artifacts'):
                return httpx2.Response(200,json={'object':'list','data':[{'id':'art_contract','turn_id':turn['id'],'path':'/workspace/outputs/changes.json'}],'has_more':False})
            if req.method=='DELETE':
                return httpx2.Response(200,json={'id':session['id'],'object':'agent.session.deleted','deleted':True})
            return httpx2.Response(200,json=session)
        with OpenAI(api_key='offline-contract-test',max_retries=0,http_client=httpx2.Client(transport=httpx2.MockTransport(handle))) as client:
            with tempfile.TemporaryDirectory() as tmp:
                request=pilot.build_request({p:b'# source\n' for p in pilot.ALLOWED_FILES},'a'*40,100)
                if failed:
                    with self.assertRaises(Exception): pilot.execute(client,request,Path(tmp)/'out',pilot.fingerprint(request))
                    self.assertFalse((Path(tmp)/'out'/'changes.json').exists())
                else:
                    state=pilot.execute(client,request,Path(tmp)/'out',pilot.fingerprint(request))
                    self.assertEqual(state['turn_id'],'turn_contract')
                    self.assertEqual(state['cleanup'],'deletion_requested')
        created=json.loads(requests[0][2])
        self.assertEqual(created['spend_control'],{'limit':100})
        self.assertEqual(created['environment']['network'],{'access':'disabled'})
        messages=[json.loads(body) for method,path,body in requests if method=='POST' and path.endswith('/events')]
        self.assertEqual(sum(m['events'][0]['type']=='agent.session.input.message' for m in messages),1)
    def test_successful_exact_turn_download_and_cleanup(self): self.exercise()
    def test_failed_turn_cannot_be_accepted(self): self.exercise(failed=True)

if __name__=='__main__': unittest.main()
