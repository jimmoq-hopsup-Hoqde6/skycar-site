#!/usr/bin/env python3
"""Validate pilot output and emit a review patch. Never execute generated code."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
from bounded_coding_pilot import PilotError, source_snapshot, validate_artifact


def review(root, sha, artifact, state_path, output):
    original = source_snapshot(root, sha)
    raw = artifact.read_bytes()
    state = json.loads(state_path.read_text())
    if (state.get('sha') != sha or state.get('status') != 'artifact_validated_NOT_TESTED'
            or state.get('cleanup') != 'deletion_requested'
            or state.get('artifact_sha256') != hashlib.sha256(raw).hexdigest()):
        raise PilotError('Artifact does not match successful pilot evidence')
    changed = validate_artifact(raw)
    diff = ''.join(''.join(difflib.unified_diff(
        original[p].decode().splitlines(keepends=True), changed[p].splitlines(keepends=True),
        fromfile='a/'+p, tofile='b/'+p)) for p in original)
    if not diff:
        raise PilotError('No code change produced')
    if any(not v.endswith('\n') for v in changed.values()):
        raise PilotError('Output files must end with a newline')
    output.mkdir(exist_ok=False)
    (output/'candidate.patch').write_text(diff)
    for p,text in changed.items():
        target=output/'candidate'/p; target.parent.mkdir(parents=True,exist_ok=True); target.write_text(text)
    (output/'review.json').write_text(json.dumps({
        'sha':sha, 'artifact_sha256':hashlib.sha256(raw).hexdigest(),
        'patch_sha256':hashlib.sha256(diff.encode()).hexdigest(),
        'status':'scope_validated_NOT_TESTED_NOT_APPROVED',
        'remaining':['secret-free disposable test run','independent QA/security review','draft PR publication'],
    },indent=2)+'\n')


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,required=True); p.add_argument('--sha',required=True)
    p.add_argument('--artifact',type=Path,required=True); p.add_argument('--state',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True); a=p.parse_args()
    review(a.root,a.sha,a.artifact,a.state,a.output)
