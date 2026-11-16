import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

scripts=Path(__file__).resolve().parents[2]/'scripts/autonomy'
sys.path.insert(0,str(scripts))
import bounded_coding_pilot as pilot
import review_pilot_artifact as reviewer

class ArtifactReviewTests(unittest.TestCase):
    def fixture(self,root):
        original={p:b'# original\n' for p in pilot.ALLOWED_FILES}
        raw=json.dumps({'task_id':pilot.TASK_ID,'files':[{'path':p,'content':'# candidate\n'} for p in original]}).encode()
        artifact=root/'changes.json';artifact.write_bytes(raw)
        state={'sha':'a'*40,'status':'artifact_validated_NOT_TESTED','cleanup':'deletion_requested','artifact_sha256':hashlib.sha256(raw).hexdigest()}
        statepath=root/'state.json';statepath.write_text(json.dumps(state))
        return original,artifact,state,statepath
    def test_valid_output_emits_patch_without_executing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);original,artifact,state,statepath=self.fixture(root)
            with patch.object(reviewer,'source_snapshot',return_value=original):
                reviewer.review(root,'a'*40,artifact,statepath,root/'review')
            self.assertIn('+# candidate',(root/'review/candidate.patch').read_text())
            self.assertEqual(json.loads((root/'review/review.json').read_text())['status'],'scope_validated_NOT_TESTED_NOT_APPROVED')
    def test_tampered_state_and_hash_fail_closed(self):
        for field,value in [('sha','b'*40),('status','failed'),('cleanup','pending'),('artifact_sha256','wrong')]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);original,artifact,state,statepath=self.fixture(root)
                state[field]=value;statepath.write_text(json.dumps(state))
                with patch.object(reviewer,'source_snapshot',return_value=original), self.assertRaises(pilot.PilotError):
                    reviewer.review(root,'a'*40,artifact,statepath,root/'review')
                self.assertFalse((root/'review').exists())
    def test_no_change_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);original,artifact,state,statepath=self.fixture(root)
            with patch.object(reviewer,'source_snapshot',return_value={p:b'# candidate\n' for p in original}), self.assertRaises(pilot.PilotError):
                reviewer.review(root,'a'*40,artifact,statepath,root/'review')
    def test_invalid_scope_rejected_even_with_matching_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);original,artifact,state,statepath=self.fixture(root)
            raw=json.loads(artifact.read_text());raw['files'][0]['path']='../escape'
            artifact.write_text(json.dumps(raw));state['artifact_sha256']=hashlib.sha256(artifact.read_bytes()).hexdigest();statepath.write_text(json.dumps(state))
            with patch.object(reviewer,'source_snapshot',return_value=original), self.assertRaises(pilot.PilotError):
                reviewer.review(root,'a'*40,artifact,statepath,root/'review')

if __name__=='__main__': unittest.main()
