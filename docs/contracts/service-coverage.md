# Service coverage contract (Adelaide metro plus Adelaide Hills)

Status: **draft PR, frontend repository only.** No migration, RLS policy, RPC or storage policy is added. The only server-side change is the resolver behind the existing `POST /api/v1/care/coverage` route, which now reads one data file instead of throwing.

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
| **Out of area** | `200 coverage:"unavailable"` | Friendly alert: "We don’t cover {postcode} yet. Skycar is starting in Adelaide and the Adelaide Hills… Nothing has been submitted." **Change postcode** button, contact line if configured. | No |
| **Unavailable / unknown** | `503 COVERAGE_UNAVAILABLE`, other 5xx, network failure or 10 s timeout, unreadable body, `200` with an unexpected or mismatched body | Separate alert: "We can’t check your area right now… nothing has been submitted. Please try again in a moment." **Try again** button, contact line if configured. Not worded as out of area. | **No. Fail-closed; there is no "continue anyway".** |
| **Invalid input** | Not exactly 4 digits (browser, no request) or server `400 VALIDATION_FAILED` | Field error "Enter your 4-digit postcode, for example 5000." with `aria-invalid`. | No |

Rules:

- A response counts as in/out of area only if it is `200`, has exactly `{service, postcode, coverage}`, and echoes what was asked. Anything else is unknown, never in area.
- A decision is remembered per `service:postcode` for the visit; the final send does not ask again. Changing the postcode or service clears it.
- The signed-in form has a new postcode field, labelled as used only to check coverage and not saved with the request (the request body is unchanged). The customer enters the postcode again later at booking, which is where it is stored today. An uncertain-submission retry ("Check same request") never re-checks.
- Mobile-first: notice text 15–17px (≥14px everywhere), buttons and links ≥44px tall (buttons 48px), no horizontal scroll at 320, 390 or 1440px (asserted in `tests/ui/care-coverage.mjs`).

### Contact fallback

No support phone or email exists in the repository config, so none is hardcoded. A marked slot is in `.env.example`:

```
SKYCAR_SUPPORT_EMAIL=
SKYCAR_SUPPORT_PHONE=
```

The two request pages read them on the server per request, validate them (email shape ≤254 chars; phone digits and `+ ( ) -` space), and pass them to the forms as props. Unset or invalid values are ignored and **no contact line is shown**; the message, the reason and the buttons still appear. **The slot is unset: Marcel must set the values in the deployment environment.** Until then an out-of-area customer sees the friendly message and "Change postcode" but no way to reach Skycar.

## 6. Backend needs

| # | Need | Tag | Notes |
|---|------|-----|-------|
| 1 | `POST /api/v1/care/coverage` route, validation, error mapping, `no-store`, same-origin check, log redaction | EXISTING | Unchanged. |
| 2 | Response shape `{data:{service,postcode,coverage},meta}` and `503 COVERAGE_UNAVAILABLE` | EXISTING | Unchanged; the UI uses it as published. |
| 3 | Resolver backed by `coverage-areas.json` | NEW, **done in this PR** | File-based, no database, no migration. Lives in `src/server/care/` (server code, bundled with the app). |
| 4 | Server-side enforcement when a request is created (`/api/v1/care/requests`, `/api/v1/care/guest-requests`) | **NEW, not done** | Creation never consults coverage, so a scripted client can still submit an out-of-area postcode. The form check is a customer courtesy, not enforcement. If enforcement is wanted, the backend owner should call the same `resolveCoverage` in those handlers and reject out-of-area with a defined error; the UI would then also need that error mapped. |
| 5 | Optional: move the list to a database table (`service`, `postcode`, `active`, `updated_at`) | NEW, optional | Only if ops want to edit coverage without a deploy. Needs a migration and RLS (backend-owned, not done). The route and UI would not change. |
| 6 | Support contact values | NEW (config only) | `SKYCAR_SUPPORT_EMAIL` / `SKYCAR_SUPPORT_PHONE` from Marcel. |
| 7 | Store the signed-in postcode with the request | NEW, optional | Needs a payload/column change; not done. |
| 8 | Refresh process for ABS data (Edition 4 POA→GCCSA/LGA files) | NEW (process) | Re-run the generator, review the diff, ship. |

## 7. Tests

- Unit `tests/unit/coverage-resolver.test.mjs`: in-area, out-of-area, borderline (included and excluded), invalid input at the route (400), unavailable (503 for broken data), data provenance, every flag re-derived from ratios, tamper/empty/duplicate/bad-ratio/unknown-service data all fail closed.
- Unit `tests/unit/care-coverage.test.mjs`, `tests/unit/support-contact.test.mjs`: the browser reader, strictness, no bypass, contact validation.
- API `tests/api/care-smoke.test.mjs`, `tests/api/origin-regression.test.mjs`: the real built route returns `200` available for 5000 and `200` unavailable for an out-of-area postcode.
- Browser `tests/ui/care-coverage.mjs` (synthetic intercepted API plus the real route and real data for in-area, out-of-area and borderline postcodes): both forms, all four states, retry, no bypass, contact line absent and present, size and overflow checks at 320/390/1440.
- Existing form tests intercept the coverage route with `tests/ui/support/coverage-fixture.mjs`.

## 8. Regenerating the data

```
curl -L -o asgs2021correspondences.zip <downloadUrl above>
unzip asgs2021correspondences.zip CG_POA_2021_GCCSA_2021.xlsx CG_POA_2021_LGA_2022.xlsx -d src-data
python3 scripts/coverage-data/build-coverage-areas.py src-data asgs2021correspondences.zip YYYY-MM-DD > src/server/care/coverage-areas.json
```

Needs Python 3 with `openpyxl`. The script holds the rule and the two LGA codes; the output holds the source URLs, retrieval date and file hashes.
