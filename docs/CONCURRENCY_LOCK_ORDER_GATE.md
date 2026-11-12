# Lock-order regression gate (integrated chain)

Canonical lock order for the journey, request, photo-marker, availability and coverage functions:
advisory(scope:key) -> vehicle -> `care_requests` -> `care_journeys` -> quote / expert rows -> (confirm only) the
`care:expert-capacity` advisory lock. Every function that locks more than one of these takes them in this order.

## The two tests and what each can see

| Test | File | Sees | Blind to |
| --- | --- | --- | --- |
| Injected-sleep pairs, outcome equals serial order, negative control | `tests/integration/week1-cross-lock-order.acceptance.mjs` | a lock taken **late** (after the sleep point); the availability capacity-lock mutant (LM3) | a lock taken in the wrong **order** before the sleep point (the sleep sits after all locks) |
| **Real-concurrency stress (the regression gate for order)** | `tests/integration/stress/week1-cross-lock-stress.sh`, run by `tests/integration/week1-cross-lock-stress.acceptance.mjs` from `garage-care-db.test.mjs` | any inversion between the queued sessions: journey cancel / start, customer review, technician start, photo heal x2 and record x2, in-area and out-of-area `care_submit_request`, availability replace, vehicle archive x2 | an inversion between two functions that are not in the session mix (add them to the mix) |

The stress script holds the journey row `FOR UPDATE`, starts the sessions so they queue behind it, and lets them race when it commits
(three random mixes per round), plus two **ordered-queue** runs per round (forward and reversed) in which each session is started only after
the previous one is seen waiting on a lock, so the queue order is known. Any `40P01` (deadlock) or statement timeout fails the test. It is
adopted from QA's `stress_week1.sh` (disposable local `skycar_integration_test` database only; it refuses anything else).
`SKYCAR_STRESS_ITERATIONS` (default 4 rounds = 20 iterations, about 1 minute) raises the count.

## Mutation evidence (lock-order mutants applied to the migrations of the integration branch, one at a time, then restored)

Mutants are QA's `mutate_lock.py` LM1 to LM5. Result with the default 4 rounds (20 iterations):

| Mutant | Stress gate | Injected-sleep test (QA, on 60a48da) |
| --- | --- | --- |
| LM1 journey takes the request lock before the vehicle lock | **killed** (6 of 20 iterations deadlocked; counts vary per run) | survived |
| LM2 `care_submit_request` locks the customer's requests before the vehicle | **killed** (12 to 13 of 20) | survived |
| LM3 availability replace takes the capacity advisory lock under its schedule row lock | survived (the mix has no journey confirm) | **killed** |
| LM4 journey takes the journey row before the request row | survived, also with 15 rounds | survived |
| LM5 `care_record_request_photos` locks the vehicle after the request | **killed** (13 to 14 of 20) | survived |
| clean chain | 0 deadlocks | pass |

LM3 is covered by the injected-sleep test. LM4 is behaviourally equivalent today, not a gap in the harness: every function that
locks both a request and its journey on the account path (`care_journey_command`, the technician and review commands) takes the
vehicle row first, so two of them can never hold the request and journey locks in opposite order; the vehicle lock serialises them.
It would matter only if a function locked request and journey without the vehicle.
