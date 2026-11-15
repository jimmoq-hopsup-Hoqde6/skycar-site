# Browser origin validation

Garage create/edit/archive, vehicle-photo intake, Care submit/reopen and coverage
share `isTrustedWriteOrigin` from `src/server/http/request-origin.mjs`.

Set server-only `SKYCAR_APP_ORIGIN` to the **exact HTTPS origin customers open**
in staging and production, for example `https://phone.example.test`. Do not add
a trailing slash, path, query, credentials or a comma-separated list. Missing or
invalid configuration denies writes. This variable is not a secret, but it is
deployment configuration and must not be selected from a request header.

The comparison does not trust `Forwarded`, `X-Forwarded-Host` or
`X-Forwarded-Proto`. Next.js can reconstruct `Request.url` using an internal
hostname, so it is not the authority for the public browser origin behind a proxy.
`Origin` must match the configured origin exactly. Missing/null/foreign origins
and `Sec-Fetch-Site: cross-site` remain rejected before persistence/storage work.

For local `SKYCAR_ENV=demo` only, an unset origin uses the request URL. When Next
normalizes a loopback URL to localhost, a loopback `Host` on the same port recovers
the actual local browser address. Non-loopback/foreign-port overrides are denied.
A configured HTTP origin is allowed only for loopback demo operation.

Changing the isolated test host requires updating this variable before testing
writes. Auth sign-in/sign-out must use this same guard when integrated. A server
that legitimately supports multiple browser origins needs a separately reviewed
explicit allowlist; do not silently use whichever Host/header arrives.

## Regression evidence

`tests/api/origin-regression.test.mjs` starts the actual production build and a
localhost-only synthetic Auth/RPC/Storage server. On the pre-correction PR #27
revision `c7603aa`, its first real-page-origin create fails with 403
`ORIGIN_REJECTED` instead of 201. The corrected runtime tests seven operations
across local, configured-proxy and unconfigured-staging cases, with six origin
variants each. Denied requests must make no RPC or Storage mutation.

The existing coverage smoke now sends the actual browser origin instead of
substituting Next's internal localhost value. Unit tests cover strict deployment
configuration, malformed/missing origins and local-host/port restrictions.

These tests prove the built HTTP boundary using fixtures. They do not establish
hosted Supabase/RLS/Storage, real proxy settings or physical-phone acceptance.
