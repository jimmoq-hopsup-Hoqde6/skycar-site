"""Reviewed task registry. Issue contents never become prompts or path selectors."""
from bounded_coding_pilot import PilotError, TaskSpec

TASK_ID = "technician-command-account-v1"
WRITE_PATHS = ("src/server/technician/http.mjs", "tests/unit/technician-commands.test.mjs")
READ_PATHS = (
    "src/domain/care/guest.mjs", "src/domain/technician/commands.mjs",
    "src/domain/technician/inbox.mjs", "src/server/care/guest-photos.mjs",
    "src/server/http/api-boundary.mjs", "src/server/http/request-origin.mjs",
    *WRITE_PATHS,
)
TEST_COMMAND = ("node", "--test", "tests/unit/technician-commands.test.mjs")
PROMPT = '''Implement one narrow technician HTTP response validation fix for Skycar issue #101.
In createTechnicianHandlers().command(), require the returned result.account to match
the x-skycar-account precondition, after validating its UUID and before accepting data.
Use the existing requireTechnicianAccount helper. A valid but different account must
return a private 403 FORBIDDEN response, with no success data or foreign account header.
Do not change authorization in repositories, database schemas, roles, transitions,
or any valid same-account responses. Retain all existing tests, and add regression
coverage for mismatched returned accounts across quote, decline, start and complete.
The only writable files are src/server/technician/http.mjs and
tests/unit/technician-commands.test.mjs. The other supplied files are read-only
dependencies. No installs, secrets, network, delegation, workflow or publishing tools.
Run node --test tests/unit/technician-commands.test.mjs.
Write /workspace/outputs/changes.json as exactly
{"task_id":"technician-command-account-v1","files":[{"path":"relative/path","content":"complete UTF-8 file content"}]}
containing both writable files. Return a short test report separately.
'''
TECHNICIAN = TaskSpec(TASK_ID, READ_PATHS, WRITE_PATHS, PROMPT)


def select(task_id):
    if task_id != TASK_ID:
        raise PilotError("Task is not in the reviewed registry")
    return TECHNICIAN


def approved_issue(issue):
    if (type(issue) is not dict or issue.get("number") != 101 or "pull_request" in issue
            or issue.get("state") != "open" or type(issue.get("labels")) is not list):
        raise PilotError("Expected the open technician issue #101")
    labels = {x.get("name") for x in issue["labels"] if type(x) is dict}
    if not {"agent-approved", "skycar-task:" + TASK_ID} <= labels:
        raise PilotError("Technician issue lacks explicit task approval labels")
    if labels & {"production", "payment", "customer-data", "secrets", "deployment", "permission-change"}:
        raise PilotError("Protected task label blocks execution")
