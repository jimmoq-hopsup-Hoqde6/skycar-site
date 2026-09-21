# Foundation API observability and error boundary

Tracks Issue #1. This is the minimum application boundary for `/api/v1` routes;
domain audit records remain transactional and operation-specific.

## Response contract

Routes adopted by `withApiBoundary` receive a server-created UUID request ID.
Success and failure use the documented envelopes:

```json
{"data":{},"meta":{"requestId":"..."}}
```

```json
{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong. Please try again.","fieldErrors":{},"retryable":true},"meta":{"requestId":"..."}}
```

The same ID is returned as `X-Request-Id`. Responses default to
`Cache-Control: private, no-store`. An incoming client header never selects the
authoritative request ID.

Expected failures use `ApiFault` with a stable uppercase code, bounded public
message and optional bounded field errors. Unknown exceptions always become the
generic `500 INTERNAL_ERROR`; caught exception text is never returned or logged.

## Structured log contract

Each adopted route writes one `api_request_completed` JSON record. Its schema is
allow-listed:

- `requestId`
- HTTP `method`
- static `route` template (never the raw URL)
- `status`
- stable `code`
- `retryable`
- `durationMs`

The logged route must be selected from the reviewed `API_ROUTE_TEMPLATES`
registry. Runtime request paths and ad-hoc strings are rejected before the route
handler executes. Parameterised routes use stable placeholder segments such as
`/api/v1/garage/vehicles/[vehicleId]/photo`; a literal UUID, numeric identifier,
email-bearing path, query string or absolute URL cannot be logged as the route.
Adding a route requires an explicit source change and review of the static
template.

Logs must not include bodies, cookies, authorization/session headers, URL query
strings, email addresses, user/customer/vehicle/job IDs, storage paths, payment
details, provider/database messages or caught stack traces. Domain identifiers and
sensitive actions belong in the protected transactional `audit_events` model, not
application logs. A logging-sink failure must never alter the API response.

## Adoption and verification

`GET /api/v1/health` is the first consumer and proves the executable boundary.
Feature routes must adopt the shared boundary when rebased/integrated; this PR does
not rewrite unmerged feature branches.

Unit tests cover canonical success, bounded expected errors, redacted unexpected
failures, exact log fields, registered placeholder templates, literal-identifier
and raw-route rejection, and log-sink failure. CI must also pass lint, TypeScript
and production build. Hosted log collection, retention,
alerting, access controls and correlation with isolated Supabase remain release
operations work; no external telemetry provider is configured here.
