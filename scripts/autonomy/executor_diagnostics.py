"""Fixed gate names only; never serialize exception messages or provider bodies."""
from contextlib import contextmanager
from bounded_coding_pilot import failure_details

GATES = frozenset({
    'source_request', 'approval_fingerprint', 'workflow_context', 'current_main',
    'environment_protection', 'issue_approval', 'build_acceptance', 'credentials',
    'billing_verification', 'billing_costs', 'billing_project', 'billing_hard_limit',
    'billing_proof', 'ledger_reservation', 'coding_session', 'session_cleanup',
    'post_run_billing', 'ledger_advance', 'coding_key', 'failed_run', 'ledger_release',
})

BILLING_REASONS = frozenset({
    'schema', 'project', 'currency', 'interval', 'enforcement',
    'requested_budget', 'limit_type', 'limit_range', 'spend_type',
    'spend_range', 'headroom', 'freshness',
})


@contextmanager
def diagnostic_gate(name):
    if name not in GATES:
        raise ValueError('Unknown diagnostic gate')
    try:
        yield
    except BaseException as exc:
        # Keep the original exception/status; the innermost controlled gate wins.
        previous = getattr(exc, '_skycar_gate', None)
        if type(previous) is not str or previous not in GATES:
            exc._skycar_gate = name
        raise


def safe_failure(exc):
    gate = getattr(exc, '_skycar_gate', None)
    result = failure_details(exc, gate if type(gate) is str and gate in GATES
                             else 'protected_executor')
    reason = getattr(exc, '_skycar_billing_reason', None)
    if type(reason) is str and reason in BILLING_REASONS:
        result['billing_reason'] = reason
    if reason == 'enforcement':
        status = getattr(exc, '_skycar_enforcement', None)
        if type(status) is str and status in ('enforcing', 'missing', 'unrecognized'):
            result['enforcement_status'] = status
    return result
