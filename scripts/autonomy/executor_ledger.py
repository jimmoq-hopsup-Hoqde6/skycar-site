"""Append-only commit history plus atomic fast-forward ref updates. No lease expiry.

Uses a Git notes namespace, not a branch: no app/source tree or deployment branch.
Initialization is a separate protected operator action; missing history never resets.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json
import re
from executor_github import GitHubError, PREFIX
from bounded_coding_pilot import MAX_CENTS, PilotError

REF = "notes/skycar-executor-ledger-v1"
# A released reservation keeps its record and its budget; this bounds how many
# owner-accepted attempts (original plus explicit supersessions) may ever exist.
MAX_OWNER_ATTEMPTS = 3
RELEASE_FIELDS = {'released_by_run_id', 'failed_run_conclusion', 'observed_spend_cents',
                  'limit_cents', 'verified_at_utc', 'session_id', 'session_absent_confirmed'}


def validate_owner_marker(marker):
    keys = {'decision_id', 'attestation_sha256'}
    if type(marker) is dict and 'supersedes_run_id' in marker:
        keys = keys | {'supersedes_run_id'}
    if (type(marker) is not dict or set(marker) != keys
            or marker['decision_id'] != 'D-009' or not isinstance(marker['attestation_sha256'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', marker['attestation_sha256'])
            or 'supersedes_run_id' in marker and (not isinstance(marker['supersedes_run_id'], str)
                or not re.fullmatch(r'[1-9][0-9]*', marker['supersedes_run_id']))):
        raise PilotError('Invalid durable owner acceptance')


def validate_release(entry):
    release = entry.get('release')
    if (type(release) is not dict or set(release) != RELEASE_FIELDS
            or not isinstance(release['released_by_run_id'], str)
            or not re.fullmatch(r'[1-9][0-9]*', release['released_by_run_id'])
            or release['released_by_run_id'] == entry['run_id']
            or release['failed_run_conclusion'] not in ('failure', 'cancelled', 'timed_out')
            or type(release['observed_spend_cents']) is not int or type(release['limit_cents']) is not int
            or not 0 <= release['observed_spend_cents'] < release['limit_cents'] <= MAX_CENTS
            or not isinstance(release['verified_at_utc'], str)
            or not isinstance(release['session_id'], str)
            or not re.fullmatch(r'sess_[A-Za-z0-9]+', release['session_id'])
            or release['session_absent_confirmed'] is not True
            or 'artifact_sha256' in entry or 'session_id' in entry):
        raise PilotError('Invalid released reservation evidence')


def month_now():
    return datetime.now(timezone.utc).strftime("%Y-%m")


def validate_state(state, project):
    if (type(state) is not dict or set(state) != {"version", "project_id", "active", "months", "tasks"}
            or type(state["version"]) is not int or state["version"] != 1 or state["project_id"] != project
            or type(state["months"]) is not dict or type(state["tasks"]) is not dict
            or len(state["tasks"]) > 100 or len(state["months"]) > 120):
        raise PilotError("Invalid durable ledger")
    if state["active"] is not None and state["active"] not in state["tasks"]:
        raise PilotError("Missing active task record")
    totals = {}
    pending = []
    owner_runs = 0
    live_owner_runs = 0
    for key, entry in state["tasks"].items():
        if (not isinstance(key, str) or type(entry) is not dict
                or not re.fullmatch(r"[a-z0-9-]+@[a-f0-9]{40}", key)
                or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", entry.get("month", ""))
                or type(entry.get("budget_cents")) is not int
                or not 1 <= entry["budget_cents"] <= MAX_CENTS
                or entry.get("phase") not in ("reserved", "coded", "publishing", "published", "released")
                or not re.fullmatch(r"[a-f0-9]{64}", entry.get("fingerprint", ""))
                or not re.fullmatch(r"\d+", entry.get("run_id", ""))):
            raise PilotError("Invalid task ledger entry")
        # Released reservations still count: the ledger never forgets reserved budget.
        totals[entry["month"]] = totals.get(entry["month"], 0) + entry["budget_cents"]
        if 'owner_risk_acceptance' in entry:
            validate_owner_marker(entry['owner_risk_acceptance'])
            owner_runs += 1
            if entry['phase'] != 'released':
                live_owner_runs += 1
        if entry['phase'] == 'released':
            validate_release(entry)
        elif 'release' in entry:
            raise PilotError('Release evidence on an unreleased task')
        if entry['phase'] not in ('published', 'released'):
            pending.append(key)
        if entry['phase'] in ('coded','publishing','published') and (
                not re.fullmatch(r'[a-f0-9]{64}',entry.get('artifact_sha256',''))
                or not re.fullmatch(r'sess_[A-Za-z0-9]+',entry.get('session_id',''))):
            raise PilotError('Missing durable artifact or session evidence')
        if entry['phase'] in ('publishing','published') and (
                not re.fullmatch(r'[a-f0-9]{40}',entry.get('candidate_commit',''))
                or not re.fullmatch(r'[a-f0-9]{64}',entry.get('validation_sha256',''))):
            raise PilotError('Missing durable publication evidence')
        if entry['phase'] == 'published' and (type(entry.get('draft_pr')) is not int or entry['draft_pr'] < 1):
            raise PilotError('Missing draft PR identity')
    if pending != ([] if state['active'] is None else [state['active']]):
        raise PilotError('Unreconciled task is missing its global lease')
    if live_owner_runs > 1 or owner_runs > MAX_OWNER_ATTEMPTS:
        raise PilotError('Owner decision permits only one live pilot and bounded explicit retries')
    if totals != state["months"] or any(type(n) is not int or not 0 <= n <= MAX_CENTS for n in totals.values()):
        raise PilotError("Ledger cumulative reservations are inconsistent")
    return state


def reserve(state, project, task, sha, fingerprint, cents, run_id, month, owner_acceptance=None):
    validate_state(state, project)
    if owner_acceptance is not None:
        validate_owner_marker(owner_acceptance)
        prior = [entry for entry in state['tasks'].values() if 'owner_risk_acceptance' in entry]
        if prior:
            # A failed attempt stays consumed. Only a fresh acceptance that names the
            # exact released run it supersedes may authorize another attempt.
            released = [entry for entry in prior if entry['phase'] == 'released']
            if (len(released) != len(prior) or len(prior) >= MAX_OWNER_ATTEMPTS
                    or owner_acceptance.get('supersedes_run_id')
                    not in {entry['run_id'] for entry in released}
                    or any(entry['owner_risk_acceptance'].get('supersedes_run_id')
                           == owner_acceptance['supersedes_run_id'] for entry in prior)):
                raise PilotError('Owner pilot acceptance is consumed, including failed or uncertain runs')
        elif 'supersedes_run_id' in owner_acceptance:
            raise PilotError('Nothing to supersede')
    key = task + "@" + sha
    if (state["active"] is not None or key in state["tasks"]
            or state["months"] and month < max(state["months"])
            or type(cents) is not int or not 1 <= cents <= MAX_CENTS
            or state["months"].get(month, 0) + cents > MAX_CENTS):
        raise PilotError("Replay, active/uncertain lease or cumulative budget blocks this run")
    result = deepcopy(state)
    result["tasks"][key] = {"fingerprint": fingerprint, "budget_cents": cents,
                            "run_id": run_id, "month": month, "phase": "reserved"}
    if owner_acceptance is not None:
        result['tasks'][key]['owner_risk_acceptance'] = deepcopy(owner_acceptance)
    result["active"] = key
    result["months"][month] = result["months"].get(month, 0) + cents
    validate_state(result, project)
    return result, key


class Ledger:
    def __init__(self, github, project):
        if not re.fullmatch(r"proj_[A-Za-z0-9]+", project):
            raise PilotError("Invalid ledger project")
        self.github, self.project = github, project

    def load(self):
        ref = self.github.request("GET", PREFIX + "/git/ref/" + REF)
        if ref.get("ref") != "refs/" + REF or ref["object"].get("type") != "commit":
            raise PilotError("Invalid ledger ref")
        sha = ref["object"]["sha"]
        commit = self.github.request("GET", PREFIX + "/git/commits/" + sha)
        tree = self.github.request("GET", PREFIX + "/git/trees/" + commit["tree"]["sha"])
        items = tree.get("tree", [])
        if (tree.get("truncated") is True or len(items) != 1 or items[0].get("path") != "ledger.json"
                or items[0].get("mode") != "100644" or items[0].get("type") != "blob"):
            raise PilotError("Ledger tree is not canonical")
        try:
            state = json.loads(self.github.blob(items[0]["sha"]))
        except (ValueError, UnicodeError):
            raise PilotError("Invalid ledger JSON") from None
        return sha, validate_state(state, self.project)

    def _commit(self, state, parent):
        validate_state(state, self.project)
        tree = self.github.request("POST", PREFIX + "/git/trees", {
            "tree": [{"path": "ledger.json", "mode": "100644", "type": "blob",
                      "content": json.dumps(state, sort_keys=True)}]})
        return self.github.request("POST", PREFIX + "/git/commits", {
            "message": "Skycar executor durable reservation audit", "tree": tree["sha"],
            "parents": [parent] if parent else []})["sha"]

    def initialize(self):
        try:
            self.github.request("GET", PREFIX + "/git/ref/" + REF)
        except GitHubError as exc:
            if exc.status_code != 404:
                raise
        else:
            raise PilotError("Ledger already exists; never reinitialize or reset")
        state = {"version": 1, "project_id": self.project, "active": None, "months": {}, "tasks": {}}
        sha = self._commit(state, None)
        # POST create is atomic: a concurrent initializer receives 422, no overwrite.
        self.github.request("POST", PREFIX + "/git/refs", {"ref": "refs/" + REF, "sha": sha})

    def save(self, expected_sha, state):
        # Sibling commits based on the same old parent cannot both fast-forward.
        sha = self._commit(state, expected_sha)
        self.github.request("PATCH", PREFIX + "/git/refs/" + REF, {"sha": sha, "force": False})
        return sha

    def claim(self, task, sha, fingerprint, cents, run_id, owner_acceptance=None):
        parent, state = self.load()
        state, key = reserve(state, self.project, task, sha, fingerprint, cents, run_id, month_now(), owner_acceptance)
        self.save(parent, state)
        return key

    def entry(self, key, fingerprint, run_id):
        parent, state = self.load()
        if state["active"] != key:
            raise PilotError("Task does not hold the global lease")
        entry = state["tasks"][key]
        if entry["fingerprint"] != fingerprint or entry["run_id"] != run_id:
            raise PilotError("Task lease does not match this exact workflow invocation")
        return parent, state, entry

    def advance(self, key, fingerprint, run_id, old_phase, new_phase, **evidence):
        parent, state, entry = self.entry(key, fingerprint, run_id)
        if entry["phase"] != old_phase or (old_phase, new_phase) not in (
                ("reserved", "coded"), ("coded", "publishing"), ("publishing", "published")):
            raise PilotError("Invalid durable task transition")
        if set(evidence) & set(entry):
            raise PilotError("Cannot overwrite immutable ledger evidence")
        entry.update(evidence, phase=new_phase)
        if new_phase == "published":
            state["active"] = None
        self.save(parent, state)

    def release(self, run_id, release):
        """Free the lease of a pre-artifact reservation; keep its record and budget."""
        parent, state = self.load()
        key = state['active']
        entry = state['tasks'].get(key) if key else None
        if (entry is None or entry['phase'] != 'reserved' or entry['run_id'] != run_id
                or 'artifact_sha256' in entry or 'session_id' in entry):
            raise PilotError('Only the active pre-artifact reservation of that run can be released')
        entry.update(phase='released', release=deepcopy(release))
        state['active'] = None
        self.save(parent, state)
        return key
