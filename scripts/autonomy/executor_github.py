"""Small fixed-repository GitHub client. No credential values in diagnostics."""
import base64
import hashlib
import json
import re
import urllib.error
import urllib.request
from bounded_coding_pilot import PilotError, REPOSITORY

PREFIX = "/repos/" + REPOSITORY


class GitHubError(PilotError):
    def __init__(self, status):
        self.status_code = status
        super().__init__("GitHub operation failed; reconcile before retry")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHub:
    def __init__(self, token):
        if not token:
            raise PilotError("Missing dedicated GitHub credential")
        self._token = token
        self._opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, body=None):
        if (method not in ("GET", "POST", "PATCH") or not path.startswith(PREFIX + "/")
                or ".." in path or "#" in path or "\n" in path):
            raise PilotError("GitHub request outside fixed repository")
        raw = None if body is None else json.dumps(body).encode()
        if raw is not None and len(raw) > 1_500_000:
            raise PilotError("GitHub payload too large")
        request = urllib.request.Request("https://api.github.com" + path, data=raw, method=method,
            headers={"Authorization": "Bearer " + self._token, "Accept": "application/vnd.github+json",
                     "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"})
        try:
            with self._opener.open(request, timeout=30) as response:
                data = response.read(2_000_001)
        except urllib.error.HTTPError as exc:
            raise GitHubError(exc.code) from None
        except Exception:
            raise PilotError("GitHub transport outcome unknown; reconcile before retry") from None
        if len(data) > 2_000_000:
            raise PilotError("GitHub response too large")
        try:
            return json.loads(data)
        except (ValueError, UnicodeError):
            raise PilotError("Invalid GitHub JSON response") from None

    def main(self):
        item = self.request("GET", PREFIX + "/branches/main")
        if item.get("protected") is not True or not re.fullmatch(r"[a-f0-9]{40}", item["commit"]["sha"]):
            raise PilotError("Main is not protected or immutable")
        return item["commit"]["sha"]

    def environment(self):
        path = PREFIX + "/environments/skycar-agent-pilot"
        env = self.request("GET", path)
        rules = env.get("protection_rules", [])
        if (env.get("name") != "skycar-agent-pilot" or env.get("can_admins_bypass") is not False
                or not any(r.get("type") == "required_reviewers" and r.get("reviewers") for r in rules)
                or env.get("deployment_branch_policy", {}).get("custom_branch_policies") is not True):
            raise PilotError("Protected environment requirements are not verified")
        policies = self.request("GET", path + "/deployment-branch-policies")
        items = policies.get("branch_policies", [])
        if (policies.get("total_count") != 1 or len(items) != 1
                or items[0].get("name") != "main" or items[0].get("type") != "branch"):
            raise PilotError("Environment must permit only main and no tags")

    def blob(self, sha):
        item = self.request("GET", PREFIX + "/git/blobs/" + sha)
        if item.get("encoding") != "base64" or item.get("size", 999_999) > 256_000:
            raise PilotError("Invalid ledger blob")
        try:
            raw = base64.b64decode(item["content"].replace("\n", ""), validate=True)
        except Exception:
            raise PilotError("Invalid ledger encoding") from None
        actual = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        if actual != sha or len(raw) > 256_000:
            raise PilotError("Ledger blob hash mismatch")
        return raw

    def commit_files(self, parent, files, message):
        commit = self.request("GET", PREFIX + "/git/commits/" + parent)
        tree = self.request("POST", PREFIX + "/git/trees", {
            "base_tree": commit["tree"]["sha"],
            "tree": [{"path": p, "mode": "100644", "type": "blob", "content": c}
                     for p, c in files.items()]})
        return self.request("POST", PREFIX + "/git/commits", {
            "message": message, "tree": tree["sha"], "parents": [parent]})["sha"]
