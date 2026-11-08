# Service coverage contract (Adelaide metro plus Adelaide Hills)

Status: **draft PR #82 (frontend) plus branch `fix/server-side-coverage-enforcement` (backend).** PR #82 on its own adds no migration, RLS policy, RPC or storage policy; its only server-side change is the resolver behind the existing `POST /api/v1/care/coverage` route. The follow-up branch adds the server-side enforcement described in §6 item 4 and §9.

**Decision (Marcel):** launch coverage is Adelaide metro plus Adelaide Hills, for both services (repair and cleaning).

## 1. Behaviour before this change (as of `5374cea`)

| # | Place | What it did |
|---|-------|-------------|
| 1 | `POST /api/v1/care/coverage` (`src/app/api/v1/care/coverage/route.ts` → `src/server/care/catalogue-http.ts`) | Validated `{service, postcode}` and called the injected `resolveCoverage`. Published in `docs/CARE_SERVICE_CATALOGUE_API.md`. |
| 2 | `resolveCoverage` in `src/server/care/catalogue.ts` | A stub that always threw `COVERAGE_UNAVAILABLE`, so every valid request got `503`. **This is why it "failed closed".** There was no data source. |
| 3 | Guest form | Collected suburb + 4-digit postcode, never called the route, saved the postcode with the request. |
| 4 | Signed-in form (`/care/request/garage`) | Had no postcode field and never called the route. The postcode is first stored in the later booking customer-details step. |
| 5 | Technician RPCs (`20261004090000_technician_inbox.sql` and later) | Per-expert matching only: `customer_details->>'postcode' = any(care_experts.postcodes)`. This decides which expert sees a job, not whether Skycar services a postcode. |
| 6 | Env/config | None for coverage or support contact. |

## 2. Where coverage lives now

```
browser form ──POST──▶ /api/v1/care/coverage ──▶ resolveCoverage ──▶ src/server/care/coverage-areas.json
 (src/domain/care/coverage.ts)   (existing route,     (src/server/care/        (single source of truth,
                                  unchanged shape)     coverage-resolver.ts)    generated from ABS data)
```

- **The check is server-side.** The browser never sees or contains the postcode list; it only asks the route and reads the published response shape.
- `src/server/care/coverage-areas.json` is the **only** place postcodes live. `coverage-resolver.ts` and the forms contain none.
- The resolver is wired in `src/server/care/catalogue.ts`; the route handler, validation, `no-store`, origin check and log redaction are unchanged.
- To change coverage: change the rule/inputs and regenerate (§8). Do not edit the JSON by hand; the resolver rejects a file whose `included` flags do not follow from the ratios it stores (see "Fail closed").

### Fail closed

The resolver throws `COVERAGE_UNAVAILABLE` (route answers `503`, retryable) when the data is missing, malformed, has no candidates, contains duplicates or bad codes, has a non-numeric ratio, has an `included` flag that does not match its own ratios and rule, includes no postcode at all, or does not know the requested service. A broken list therefore never reads as "out of area" or "covered". A postcode that is simply not in the list is a completed decision: `200`, `coverage: "unavailable"`.

## 3. Source and inclusion rule

**Source (authoritative, citable):** Australian Bureau of Statistics, *ASGS Edition 3 (2021) Correspondence Files*, licence CC BY 4.0.

- Dataset: <https://data.gov.au/data/dataset/asgs-edition-3-2021-correspondences> (metadata updated 2026-10-14)
- Downloaded: <https://data.gov.au/data/dataset/2c79581f-600e-4560-80a8-98adb1922dfc/resource/33d822ba-138e-47ae-a15f-460279c3acc3/download/asgs2021correspondences.zip>
- ABS page: <https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/correspondences>
- **Retrieved: 2026-11-01** (Adelaide, UTC+10:30)
- zip SHA-256: `3c4ca9307b86dd9c51626920ddbb64fbe38936fd30f4e2c846eb71569dcb1c60`
- Files used (SHA-256 inside the data file):
  - `CG_POA_2021_GCCSA_2021.xlsx` — postal area → Greater Capital City Statistical Area, population-weighted ratios (`edf86d17…93ea0`).
  - `CG_POA_2021_LGA_2022.xlsx` — postal area → Local Government Area (newest POA→LGA file in the set) (`c0b4797b…f5a`).

The ABS correspondence ratio is the share of a postal area's modelled population that falls in each region. "Postcode" below means ABS Postal Area (POA), which the ABS defines as a Mesh Block approximation of Australia Post postcodes.

**Inclusion rule (single rule, applied by code, threshold 0.5):** include a postcode when

1. its share in **GCCSA 4GADE Greater Adelaide** is ≥ 0.5, **or**
2. its combined share in **LGA 40120 Adelaide Hills** and **LGA 44550 Mount Barker** is ≥ 0.5.

Why this rule: Marcel's wording is "Adelaide metro plus Adelaide Hills". The ABS Greater Adelaide GCCSA is the standard definition of the metro area, and the Hills are covered by naming the two Hills councils (Adelaide Hills Council and Mount Barker District Council; identities and suburb lists: <https://www.localcouncils.sa.gov.au/get-involved/find-your-council/adelaide-hills-council> and <https://www.localcouncils.sa.gov.au/get-involved/find-your-council/mount-barker-district-council>).

Result: **151 candidate postcodes** (anything with a non-zero share in Greater Adelaide or either Hills council), **147 included**, **4 excluded**. Of the included, 139 are wholly inside Greater Adelaide and 8 are partly inside (listed below). Rule 2 adds nothing beyond rule 1 today, because every Hills postcode that qualifies is already in Greater Adelaide; it is kept so the Hills stay covered if the GCCSA source changes.

The threshold is not sensitive: the partial postcodes have Greater Adelaide shares of 0.154, 0.785, 0.795 and above, so any threshold between 0.16 and 0.78 gives the same 147.

### Currency check (ASGS Edition 4)

Edition 3 ran to June 2026; the ABS released Edition 4 on 2026-07-22 (Postal Areas on 2026-10-14). I did not find Edition 4 POA→GCCSA or POA→LGA ratio files (only the 2021→2026 Postal Area and GCCSA files were used). Checked on 2026-11-01:

- `CG_POA_2021_POA_2026.csv` (SHA-256 `52746d43…107aa`): of the 151 candidates only **5169** (0.9% to 5167) and **5254** (3.6% to 5252) change at all, and no 5xxx postal area was created or renamed. Neither changes a decision (5169 is wholly in Greater Adelaide; 5254 is excluded either way).
- `CG_GCCSA_2021_GCCSA_2026.csv` (SHA-256 `60c2ed1f…f9f6e`): `4GADE → 4GADE`, ratio 1.
- Re-run the generator when ABS publishes Edition 4 POA→GCCSA/LGA files (§8).

## 4. Borderline postcode decisions

Shares are ABS population ratios from the files above (GA = Greater Adelaide; Hills = Adelaide Hills + Mount Barker LGAs; other LGAs from the POA→LGA file). Every decision follows mechanically from the rule; none is a judgement call except where flagged for Marcel.

| Postcode | GA | Hills | Other (ABS LGA file) | Decision | Why / note |
|---|---|---|---|---|---|
| 5153 | 0.994 | 0.964 | Onkaparinga 0.03 | **Included** | Hills + GA. |
| 5244 | 0.986 | 0.986 | Mid Murray 0.01 | **Included** | Hills. |
| 5201 | 0.884 | 0.859 | Alexandrina 0.12, Onkaparinga 0.02 | **Included** | Mostly Mount Barker LGA. |
| 5157 | 0.863 | 0.043 | Onkaparinga 0.82, Alexandrina 0.14 | **Included** | In by GA share only. Flag: mostly Onkaparinga, not Hills. |
| 5172 | 0.795 | 0 | Onkaparinga 0.80, Alexandrina 0.21 | **Included** | In by GA share only. Flag: outer southern metro, not Hills. |
| 5174 | 0.993 | 0 | Onkaparinga 0.99 | **Included** | GA. |
| 5371 | 0.785 | 0 | Light 1.0 | **Included** | In by GA share only. Flag: Greater Adelaide includes part of the Light LGA; northern fringe. |
| 5501 | 0.798 | 0 | Adelaide Plains 0.99 | **Included** | In by GA share only. Flag: northern fringe. |
| 5254 | 0.154 | 0.154 | Murray Bridge 0.74, Mid Murray 0.11 | **Excluded** | 15% Mount Barker LGA, 74% Murray Bridge. Flag: the Mount Barker council lists Callington as its suburb, so Marcel may want this added. |
| 5235 | 0.021 | 0.021 | Barossa 0.93 | **Excluded** | Barossa. |
| 5400 | 0.022 | 0 | Light 1.0 | **Excluded** | Mostly Rest of SA. |
| 5351 | 0.000002 | 0 | Barossa 1.0 | **Excluded** | Rounding-level GA share. |

Other limits to know about:

- **Fringe suburbs are in because Greater Adelaide is wider than the inner metro** (postcodes 5157, 5172, 5371, 5501 above). If Marcel wants a tighter "metro" than the ABS GCCSA, change the rule and regenerate; do not hand-edit.
- **Postcodes not in the ABS Postal Area list** (for example some PO Box or large-volume postcodes) are not candidates and are answered as out of area. The ABS notes POAs "may not match every Australia Post postal code".
- Postal Area boundaries are a generalisation; a person on the edge of a postcode may be treated by the postcode answer, not their street.
- Suburb names are not part of the decision. The form's suburb field is free text; only the postcode is checked.
- Cross-check, not a source: a third-party postcode list for the two councils (postcodes.refdat.com) agrees with this result for every included Hills postcode and differs only on 5254.

### Included postcodes (147)

5000, 5006, 5007, 5008, 5009, 5010, 5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018, 5019, 5020, 
5021, 5022, 5023, 5024, 5025, 5031, 5032, 5033, 5034, 5035, 5037, 5038, 5039, 5040, 5041, 5042, 
5043, 5044, 5045, 5046, 5047, 5048, 5049, 5050, 5051, 5052, 5061, 5062, 5063, 5064, 5065, 5066, 
5067, 5068, 5069, 5070, 5072, 5073, 5074, 5075, 5076, 5081, 5082, 5083, 5084, 5085, 5086, 5087, 
5088, 5089, 5090, 5091, 5092, 5093, 5094, 5095, 5096, 5097, 5098, 5106, 5107, 5108, 5109, 5110, 
5111, 5112, 5113, 5114, 5115, 5116, 5117, 5118, 5120, 5121, 5125, 5126, 5127, 5131, 5132, 5133, 
5134, 5136, 5137, 5138, 5139, 5140, 5141, 5142, 5144, 5150, 5151, 5152, 5153, 5154, 5155, 5156, 
5157, 5158, 5159, 5160, 5161, 5162, 5163, 5164, 5165, 5166, 5167, 5168, 5169, 5170, 5171, 5172, 
5173, 5174, 5201, 5231, 5232, 5233, 5234, 5240, 5241, 5242, 5243, 5244, 5245, 5250, 5251, 5252, 
5371, 5501, 5950

The authoritative copy is `src/server/care/coverage-areas.json` (with each postcode's ratios). The unit test re-derives every flag from those ratios.

## 5. UX states

The forms never decide coverage; they read the existing response shape (`docs/CARE_SERVICE_CATALOGUE_API.md`).

| State | Trigger | Customer sees | Can continue? |
|-------|---------|---------------|---------------|
| **In area** | `200 coverage:"available"`, echoing the same service and postcode | Guest form moves on; the review step shows "Skycar covers {postcode}. A quote, expert and appointment still need confirmation." Signed-in form creates the request. | Yes |
| **Out of area** | `200 coverage:"unavailable"` | Friendly alert: "We don’t cover {postcode} yet. Skycar is starting in Adelaide and the Adelaide Hills… Nothing has been submitted." **Change postcode** button, contact line (default email, plus phone if configured). | No |
| **Unavailable / unknown** | `503 COVERAGE_UNAVAILABLE`, other 5xx, network failure or 10 s timeout, unreadable body, `200` with an unexpected or mismatched body | Separate alert: "We can’t check your area right now… nothing has been submitted. Please try again in a moment." **Try again** button, contact line (default email, plus phone if configured). Not worded as out of area. | **No. Fail-closed; there is no "continue anyway".** |
| **Invalid input** | Not exactly 4 digits (browser, no request) or server `400 VALIDATION_FAILED` | Field error "Enter your 4-digit postcode, for example 5000." with `aria-invalid`. | No |

Rules:

- A response counts as in/out of area only if it is `200`, has exactly `{service, postcode, coverage}`, and echoes what was asked. Anything else is unknown, never in area.
- A decision is remembered per `service:postcode` for the visit (the key carries the service, so a repair answer is never reused for cleaning); the final send does not ask again. Changing the postcode or the service clears the on-screen notice and confirmation; coming back to a pair already decided reuses its answer.
- The out-of-area and unavailable notices are `role="alert"` so assistive technology announces them (asserted for both forms).
- The signed-in form has a new postcode field, labelled as used only to check coverage and not saved with the request (it is now sent in the create body, so the server can enforce the same check; see §9). The postcode is stored later, in the journey page's "Service details" form. That form now offers the postcode the customer already typed for the check (see "Signed-in postcode hand-off" below), so it is confirmed rather than typed again. An uncertain-submission retry ("Check same request") never re-checks.
- **Signed-in postcode hand-off (browser only, no backend change).** After a successful create, the signed-in form keeps the checked postcode in `sessionStorage` (this tab only; key `skycar:checked-postcode:<request id>`; only a 4-digit value for a UUID id is stored or read). The journey page's "Service details" form uses it as the starting value of the Postcode field only when the request is a Garage (`account`) request and the server snapshot has no postcode yet, with the note "Filled in from the postcode you used for the area check. Check it, then save." Nothing is saved until the customer presses **Save service details**, which sends the existing `update_details` action unchanged; the server validates it as before. The value is dropped after a successful save. A postcode already held by the server always wins. Limits: it does not cross tabs or devices, and the customer still has to press Save (and enter suburb), because creation does not accept a postcode (row 7 below).
- A late coverage answer for a service or postcode that is no longer selected is ignored in both forms (the guest form compares against the live selection, not the render that started the check), so it can neither show a notice nor advance the form.
- Mobile-first: notice text 15–17px (≥14px everywhere), buttons and links ≥44px tall (buttons 48px), no horizontal scroll at 320, 390 or 1440px (asserted in `tests/ui/care-coverage.mjs`).

### Contact fallback

| Channel | Default | Override | Shown when |
|---|---|---|---|
| Email | `info@skycar.au` (public, non-secret; constant `DEFAULT_SUPPORT_EMAIL` in `src/domain/care/support-contact.ts`) | `SKYCAR_SUPPORT_EMAIL` | Always (default or valid override) |
| Phone | **none** | `SKYCAR_SUPPORT_PHONE` | Only when set to a valid number |

`.env.example` documents both variables (commented out). The two request pages read them on the server per request, validate them (email shape ≤254 chars; phone digits and `+ ( ) -` space) and pass the result to the forms as props.

- Email: a `mailto:` link, at least 44px tall. A valid env value overrides the default; a blank or invalid value keeps the default, so the contact never disappears because of a bad setting.
- Phone: no default and no phone number is hardcoded. With `SKYCAR_SUPPORT_PHONE` unset or invalid there is no `tel:` link and no phone text. When valid it is shown as a `tel:` link, at least 44px tall, next to the email.
- No Vercel or Supabase environment or secret is read or changed by this: the default lives in committed code, and the env variables are optional overrides.
- The notice's `data-contact` attribute reports `email`, `email-phone`, `phone` or `none` (tests use it).

## 6. Backend needs

| # | Need | Tag | Notes |
|---|------|-----|-------|
| 1 | `POST /api/v1/care/coverage` route, validation, error mapping, `no-store`, same-origin check, log redaction | EXISTING | Unchanged. |
| 2 | Response shape `{data:{service,postcode,coverage},meta}` and `503 COVERAGE_UNAVAILABLE` | EXISTING | Unchanged; the UI uses it as published. |
| 3 | Resolver backed by `coverage-areas.json` | NEW, **done in this PR** | File-based, no database, no migration. Lives in `src/server/care/` (server code, bundled with the app). |
| 4 | Server-side enforcement when a request is created (`/api/v1/care/requests`, `/api/v1/care/guest-requests`) | **DONE on `fix/server-side-coverage-enforcement`** | `care_submit_request` and `care_submit_guest_request` reject out-of-area with `OUT_OF_AREA` (422) and fail closed with `COVERAGE_UNAVAILABLE` (503). See §9. |
| 5 | Database copy of the list | **DONE as a generated mirror** | `public.care_service_coverage` is generated from `coverage-areas.json` by `scripts/coverage-data/build-coverage-migration.mjs`; the JSON stays authoritative. Ops still change coverage by migration + deploy, not by editing the table. |
| 6 | Support contact values | NEW (config only) | Email defaults to `info@skycar.au` in code. `SKYCAR_SUPPORT_PHONE` (and an email override, if wanted) from Marcel; the phone stays hidden until set. |
| 7 | Store the signed-in postcode with the request | NEW, optional | Needs a payload/column change; not done. Until then the browser hand-off above only pre-fills the later details form. |
| 8 | Refresh process for ABS data (Edition 4 POA→GCCSA/LGA files) | NEW (process) | Re-run the generator, review the diff, ship. |

## 7. Tests

- Unit `tests/unit/coverage-resolver.test.mjs`: in-area, out-of-area, borderline (included and excluded), invalid input at the route (400), unavailable (503 for broken data), data provenance, every flag re-derived from ratios, tamper/empty/duplicate/bad-ratio/unknown-service data all fail closed, and the threshold boundary (a share of exactly 0.5 is included, just below is excluded, for the Greater Adelaide share and the combined Hills share; a mismatched flag at the boundary fails closed; no real postcode sits within 0.01 of the threshold).
- Unit `tests/unit/care-coverage.test.mjs`, `tests/unit/support-contact.test.mjs`: the browser reader, strictness, no bypass, contact validation, default email, phone hidden when unset.
- API `tests/api/care-smoke.test.mjs`, `tests/api/origin-regression.test.mjs`: the real built route returns `200` available for 5000 and `200` unavailable for an out-of-area postcode.
- Browser `tests/ui/care-coverage.mjs` (synthetic intercepted API plus the real route and real data for in-area, out-of-area and borderline postcodes): both forms, all four states, retry, no bypass, default email present and phone hidden when unset, env override showing email and phone, size and overflow checks at 320/390/1440.
- Browser `tests/ui/care-coverage-stale.mjs` (ported from QA's `stale.mjs`, plus the hand-off): guest and signed-in notice clearing on a service or postcode change, a late answer for the old service in the guest form (out of area, unknown and available) never shows a notice or advances the form, a late answer for the current selection still advances, the signed-in form is locked during a check, and the checked postcode is offered once on the journey page and saved only through `update_details`.
- Existing form tests intercept the coverage route with `tests/ui/support/coverage-fixture.mjs`.

## 8. Regenerating the data

```
curl -L -o asgs2021correspondences.zip <downloadUrl above>
unzip asgs2021correspondences.zip CG_POA_2021_GCCSA_2021.xlsx CG_POA_2021_LGA_2022.xlsx -d src-data
python3 scripts/coverage-data/build-coverage-areas.py src-data asgs2021correspondences.zip YYYY-MM-DD > src/server/care/coverage-areas.json
```

Needs Python 3 with `openpyxl`. The script holds the rule and the two LGA codes; the output holds the source URLs, retrieval date and file hashes.

## 9. Server-side enforcement at request creation

One list, two readers. `src/server/care/coverage-areas.json` is authoritative. The database cannot read it, so a generated mirror is migrated: `supabase/migrations/20261101160000_care_service_coverage_enforcement.sql` creates `public.care_service_coverage(service, postcode)` and `care_service_coverage_meta(area_id, version)` and seeds them from the **same** `buildCoverageIndex()` the resolver uses (`scripts/coverage-data/build-coverage-migration.mjs`; the block between the `GENERATED COVERAGE SEED` markers). Both tables are RLS-enabled with every grant revoked (no browser, anon or service role can read or edit them); only the SECURITY DEFINER function `care_assert_postcode_covered(service, postcode)` (`search_path=''`) reads them.

- **Authenticated:** `care_submit_request` takes a fifth key, `postcode` (`^[0-9]{4}$`; the legacy four-key shape remains valid for replay and, until the sunset below, create). Order: advisory lock → idempotency lookup (a replay returns the existing request with no area decision) → coverage or legacy gate → vehicle `FOR UPDATE` → policy → insert. An out-of-area request locks and writes nothing. Commands stored before the migration have no postcode and replay against the other four fields. A legacy create is gated again after the insert and, only if that second check still passes, increments `care_legacy_create_audit` in the same transaction.
- **Guest:** `care_submit_guest_request` runs the same check after its replay lookup and before the rate limits and insert. The route stores photos only after the function returns a receipt, so a rejected request does no Storage I/O (`src/server/care/guest-intake.mjs`).
- **Errors:** `OUT_OF_AREA` (422, `retryable:false`), `COVERAGE_UNAVAILABLE` (503, `retryable:false`: the list is missing or empty for that service; nothing was submitted).
- **Drift is a test failure:** `tests/unit/coverage-enforcement.test.mjs` compares the latest seed block with the JSON-derived one; `tests/integration/coverage-enforcement.acceptance.mjs` compares the live table with the JSON.
- **Changing coverage:** regenerate the JSON, then add a NEW migration whose filename contains `care_service_coverage` and whose body is the regenerated seed block (it deletes and reseeds both tables). Never edit an applied migration. The drift test always reads the newest such migration.
- **Not covered:** guest requests and signed-in requests created before this migration are not re-checked, and later technician or journey writes do not consult the list.

### Deploy order (signed-in create, migration and app in either order)

The signed-in payload changed from four keys to five (`postcode`). Neither deploy order may break signed-in create or turn an exact retry into `VALIDATION_FAILED`:

| Order | State | What happens |
|---|---|---|
| Migration first | new database, old app/stale tab sends four keys | `care_submit_request` accepts the legacy four-key shape. **Replay** of any existing key returns the original receipt (never `VALIDATION_FAILED`). **Create** is allowed only while `care_legacy_create_open(clock_timestamp())` is true: the compat boolean is true, its row exists, and the clock is **strictly before** 2026-11-22 00:00 Australia/Adelaide (`2026-11-21T13:30:00Z`). That create has no postcode and is therefore **not** area-checked. It is counted. At the cap it is `VALIDATION_FAILED` and stores nothing, even if the boolean is still true. |
| App first | new app sends five keys, old database | The old function rejects the fifth key as `VALIDATION_FAILED` and stores nothing. `careHandlers.submit` retries **once**, same idempotency key, with the four legacy keys (only for `VALIDATION_FAILED` on a payload that had a postcode; `OUT_OF_AREA`, `COVERAGE_UNAVAILABLE`, conflicts and outages are never retried). The form has already checked the area through `/api/v1/care/coverage`. Once the migration is applied the same key replays against the stored four-key command. |
| Stale tab, new app | new app route, old browser JS | `careInput` accepts the four-key shape and forwards it unchanged (no postcode is invented). The database decides replay or create as above. |

Replay compares the postcode only when both the stored command and the call carry one: four request fields otherwise. Two different postcodes under one key remain `IDEMPOTENCY_CONFLICT`. A replay never increments the legacy-create count. A present postcode is always area-checked; the sunset does not weaken that path.

**Sunset (Backend & Security), forward-only.** `supabase/migrations/20261108120000_care_legacy_create_sunset.sql` is the close. It does not edit `20261101160000`. Apply it in filename order immediately after `20261101160000`, in the same maintenance window, before traffic uses a database that has only the boolean. Until `20261108120000` is applied, `accept_legacy_create = true` still has no clock and a signed-in caller can omit `postcode`.

The boolean is not the sunset. It stays `true` so the compatibility path works until the cap. Backend & Security may close earlier, from a privileged session, with either statement:

```sql
update public.care_service_coverage_compat set accept_legacy_create = false;
update public.care_service_coverage_compat
  set legacy_create_deadline = timestamptz '2026-11-21 13:30:00+00' - interval '1 second';
```

A deadline later than `2026-11-21T13:30:00Z` is rejected by `care_service_coverage_compat_deadline_cap`. The function also compares against that same instant, so dropping the constraint does not extend the window. A missing compat row, a null deadline, or a missing audit row fails closed for a legacy **create** only. Postcode creates do not read the audit row.

`care_legacy_create_audit` holds one row: `create_count`, `first_created_at`, `last_created_at`. No customer, vehicle, key or payload. RLS is enabled and not forced (the definer function runs as the table owner and must increment the row). `REVOKE ALL` from `public`, `anon`, `authenticated` and `service_role` is the customer boundary; `service_role` bypasses RLS and still has no grant. There is no sequence. A trigger rejects deletes, truncates and any update that is not `create_count + 1`. The migration owner can still disable that trigger; customers cannot. Creates that committed before `20261108120000` are not backfilled.

The route retry stays in this change. On a database that has the sunset migration, a valid five-key body is not `VALIDATION_FAILED`, so the retry does not strip the postcode. A four-key create at or after the cap is `VALIDATION_FAILED` and is not retried, because the retry runs only when the first body had a postcode. Removing the retry and making `careInput` require `postcode` is a later change: it waits until every database has `20261101160000`, because an older function still rejects five keys and the retry is what keeps that deploy order working.

**Why `20261101160000` was not edited.** It is not on `origin/main`. The staging install record `docs/staging/V2_NINE_MIGRATION_INSTALL.md` at `a1bd60c` (branch `docs/staging-nine-migration-checklist`, 2026-11-02) section 11 lists ten files applied on 1 Nov 2026 and does not include it. Section 12 lists it among eight files **not yet installed**, at blob `9a48a212` (`7f8071f`). The file on this branch is blob `837ba184` (`0eb3e74`), the same blob as `integration/week1-candidate` `ff2c941`. No later commit in this clone records an apply of either blob. Hosted staging and production were not read for this change, so live status is **not** claimed. The file's own comment still describes a manual `accept_legacy_create = false` follow-up; that comment is frozen with the file. This section is the current rule.

### Closure verification

Run this as the migration owner, not through the Data API. Do not grant the audit table or `care_legacy_create_open` to `anon`, `authenticated` or `service_role`.

```sql
select clock_timestamp() >= timestamptz '2026-11-21 13:30:00+00' as at_or_after_cap,
       public.care_legacy_create_open(clock_timestamp()) as legacy_create_open,
       accept_legacy_create,
       legacy_create_deadline,
       create_count, first_created_at, last_created_at
from public.care_service_coverage_compat
cross join public.care_legacy_create_audit;
```

Before the cap, `legacy_create_open` is true while the boolean is true. At and after the cap it is false. Then confirm a legacy create fails closed without changing the count. Use a disposable customer and roll the probe back:

```sql
begin;
-- set local role authenticated; set the test customer's jwt sub; call care_submit_request
-- with the four legacy keys and a fresh idempotency key.
-- Expect VALIDATION_FAILED at or after the cap. create_count must be unchanged after rollback.
rollback;
```

A five-key in-area create must still succeed, and a five-key out-of-area create must still be `OUT_OF_AREA`. Replay of a key that already exists must return the original receipt in both shapes.

### QA probe expectations

`/workspace/qa/repro/cov-srv/cov_probe.sh` is not in this repository (no tracked path on the fetched remotes, and the file is not on the machine that wrote this). It was not edited. QA recorded stale `VALIDATION_FAILED` expectations at lines 92 and 95. If those lines treat every signed-in body that omits `postcode` as `VALIDATION_FAILED`, that is stale. The corrected split is:

- Replay of an existing key, four-key or five-key: the original receipt, never `VALIDATION_FAILED`, before and after the cap.
- Legacy create before `2026-11-21T13:30:00Z` while the compat row exists and `accept_legacy_create` is true: success, no area check, audit count increases by one.
- Legacy create at or after that instant, or with the boolean false, or with the compat or audit row missing: `VALIDATION_FAILED`, no new request, audit count unchanged.
- A present postcode is area-checked (`OUT_OF_AREA` or `COVERAGE_UNAVAILABLE`), including after the cap.
- A three-key body, or a four-key body plus an unknown key, remains `VALIDATION_FAILED`.

