# Care service catalogue and coverage API (#3 / #18)

Contract version: 1. This contract is published before a frontend consumer.
It exposes the approved entry services and a provider-neutral coverage decision.
It does not create a Care request or claim that a technician, price, quote,
appointment or payment is available.

## Public catalogue

`GET /api/v1/care/services`

This route is public. It returns the server-owned service identifiers accepted
by the Care request API. Clients must not maintain a separate list or invent
additional identifiers.

```json
{
  "data": {
    "services": [
      {"id":"repair","name":"Scratch & dent repair"},
      {"id":"cleaning","name":"Detailing & cleaning"}
    ]
  },
  "meta": {"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
}
```

The response may be cached briefly as public catalogue data. It contains no
customer, provider, pricing or availability information.

## Coverage decision

`POST /api/v1/care/coverage`

Body (maximum 1 KiB, exact fields):

```json
{"service":"repair","postcode":"5000"}
```

- `service`: `repair | cleaning`, sourced from the catalogue above.
- `postcode`: exactly four ASCII digits. It is a lookup value, not a saved
  customer address.

The write-style request requires an exact same-origin `Origin` and
`application/json`. Its response is `Cache-Control: no-store`.

An authoritative resolver may return one of two successful decisions:

```json
{
  "data": {"service":"repair","postcode":"5000","coverage":"available"},
  "meta": {"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
}
```

```json
{
  "data": {"service":"repair","postcode":"5000","coverage":"unavailable"},
  "meta": {"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
}
```

`unavailable` is a completed coverage decision. If a resolver is missing,
unreachable, malformed or cannot make a decision, the API must instead fail
closed with HTTP 503:

```json
{
  "error": {
    "code":"COVERAGE_UNAVAILABLE",
    "message":"Coverage cannot be confirmed right now.",
    "fieldErrors":{},
    "retryable":true
  },
  "meta": {"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
}
```

The route must never translate an operational error into either successful
decision. No postcode is considered covered merely because it is valid.

## Errors and privacy

- `400 VALIDATION_FAILED`: malformed JSON, unknown fields, unsupported service
  or invalid postcode.
- `403 CSRF_FAILED`: absent or non-matching origin.
- `413 PAYLOAD_TOO_LARGE`: body exceeds the stream limit.
- `415 UNSUPPORTED_MEDIA_TYPE`: body is not JSON.
- `503 COVERAGE_UNAVAILABLE`: no authoritative coverage decision is available;
  retrying later is safe.
- `500 INTERNAL_ERROR`: redacted unexpected server failure.

All envelopes include a request ID and `X-Content-Type-Options: nosniff`.
Bodies, postcodes, cookies and resolver/provider details are not logged. This
increment deliberately includes no provider activation, coverage areas,
commercial terms, schema migration or environment variable.

## Rollout boundary

The catalogue may be published independently. Coverage remains honestly
unavailable until an approved authoritative resolver is connected and its
available/unavailable decisions pass acceptance tests. A successful coverage
decision permits the customer to continue to Garage and Care intake; it is not
a quote, assignment, appointment or service guarantee.
