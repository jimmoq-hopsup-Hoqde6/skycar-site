"""Read-only provider verification. Never accepts operator supplied budget evidence."""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
import re
from bounded_coding_pilot import MAX_CENTS, PilotError
from executor_diagnostics import diagnostic_gate


def validate_proof(proof, project, requested, now=None, require_headroom=True):
    def reject(reason):
        failure = PilotError('Provider budget evidence rejected')
        failure._skycar_billing_reason = reason
        if reason == 'enforcement':
            status = proof['enforcement']
            if status is None:
                failure._skycar_enforcement = 'missing'
            elif type(status) is str and status == 'enforcing':
                failure._skycar_enforcement = 'enforcing'
            else:
                failure._skycar_enforcement = 'unrecognized'
        raise failure

    fields = {"project_id", "currency", "interval", "limit_cents", "enforcement",
              "observed_spend_cents", "verified_at_utc"}
    if type(proof) is not dict or set(proof) != fields:
        reject('schema')
    if not re.fullmatch(r"proj_[A-Za-z0-9]+", project) or proof['project_id'] != project:
        reject('project')
    # Owner-authorized pilot policy: accept the observed inactive state only
    # with dashboard hard-limit verification as a manual precondition. This
    # does not establish that inactive proves enforcement is enabled.
    for field in ('currency', 'interval', 'enforcement'):
        if proof[field] != {'currency': 'USD', 'interval': 'month', 'enforcement': 'inactive'}[field]:
            reject(field)
    if type(requested) is not int or not 1 <= requested <= MAX_CENTS:
        reject('requested_budget')
    if type(proof['limit_cents']) is not int:
        reject('limit_type')
    if not 1 <= proof['limit_cents'] <= MAX_CENTS:
        reject('limit_range')
    if type(proof['observed_spend_cents']) is not int:
        reject('spend_type')
    if not 0 <= proof['observed_spend_cents'] < proof['limit_cents']:
        reject('spend_range')
    if require_headroom and proof['observed_spend_cents'] + requested > proof['limit_cents']:
        reject('headroom')
    try:
        verified = datetime.fromisoformat(proof["verified_at_utc"])
        current = datetime.now(timezone.utc) if now is None else now
        if verified.utcoffset() is None or not 0 <= (current - verified).total_seconds() <= 30:
            raise ValueError()
    except (TypeError, ValueError, OverflowError):
        reject('freshness')
    return dict(proof)


class ProviderBilling:
    def __init__(self, client):
        self.client = client

    def verify(self, project, requested, require_headroom=True):
        if not re.fullmatch(r"proj_[A-Za-z0-9]+", project):
            raise PilotError("Invalid project ID")
        with diagnostic_gate('billing_costs'):
            now = datetime.now(timezone.utc)
            start = int(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())
            total = Decimal(0)
            page = None
            seen = set()
            for _ in range(10):
                options = {"page": page} if page is not None else {}
                costs = self.client.admin.organization.usage.costs(
                    start_time=start, end_time=int(now.timestamp()) + 1,
                    project_ids=[project], group_by=["project_id"], limit=31, **options)
                for bucket in costs.data:
                    for row in bucket.results:
                        if (row.object != "organization.costs.result" or row.project_id != project
                                or row.amount is None or row.amount.currency != "usd"
                                or type(row.amount.value) not in (int, float)):
                            raise PilotError("Unverifiable project cost data")
                        value = Decimal(str(row.amount.value))
                        if not value.is_finite():
                            raise PilotError("Invalid cost amount")
                        total += max(value, Decimal(0))
                if costs.has_more is False:
                    break
                page = costs.next_page
                if not isinstance(page, str) or not page or page in seen:
                    raise PilotError("Unverifiable cost pagination")
                seen.add(page)
            else:
                raise PilotError("Project cost pagination exceeds bounds")
        with diagnostic_gate('billing_project'):
            record = self.client.admin.organization.projects.retrieve(project)
            if record.id != project or record.status != "active":
                raise PilotError("Provider did not confirm an active project")
        with diagnostic_gate('billing_hard_limit'):
            limit = self.client.admin.organization.projects.spend_limit.retrieve(project)
            if limit.object != "project.spend_limit":
                raise PilotError("Provider did not return a project hard limit")
        with diagnostic_gate('billing_proof'):
            proof = {"project_id": project, "currency": limit.currency, "interval": limit.interval,
                     "limit_cents": limit.threshold_amount, "enforcement": limit.enforcement.status,
                     "observed_spend_cents": int((total * 100).to_integral_value(rounding=ROUND_CEILING)),
                     "verified_at_utc": datetime.now(timezone.utc).isoformat()}
            return validate_proof(proof, project, requested, require_headroom=require_headroom)
