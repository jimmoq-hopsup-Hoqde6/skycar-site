# Connected Care hosted acceptance

## Verified preflight — 4 October 2026

Candidate reviewed: `06a585cbfcd55328c2fbeded99f6dc5ab8ba5ed3`, draft PR #47. Staging remains `47241fceed8f5207de918906a35a7f3165c6b6c4`.

Read-only Supabase inspection confirmed the staging project is healthy, the journey migration is absent, and there are no existing development branches. The role inventory contains a customer role but no administrator. RLS is enabled on user_roles, care_requests, care_guest_requests, vehicles and media_assets. These metadata checks do not prove allowed/denied API or storage behaviour.

Do not promote the existing customer to unblock testing. The owner must identify a dedicated test-operator account and explicitly authorise its admin role, or supply an already-authorised operator account through a secure sign-in flow. Never put credentials in this document or GitHub.

## Before hosted writes

1. Review the full candidate and existing release/backup controls; passing CI is not independent release approval.
2. Confirm the exact isolated database and runtime, recoverable backup, private storage, environment flags, application origin and required approval controls. Do not create a paid database branch without cost approval.
3. Identify the authorised operator and two synthetic customer sessions. Keep guest testing in a third isolated browser context. Do not reuse real customer data.
4. Apply only the reviewed pending migration through the approved release path. Do not run disposable PostgreSQL bootstrap/auth/storage fixture scripts against hosted Supabase.
5. Verify migration inventory, RLS, grants and advisors, then run the candidate against that isolated database before staging promotion.

## Required real acceptance

Use actual API/database/storage responses, with no API interception or mock provider. Record route templates, status/error codes, candidate revision and pass/fail only in public evidence. Keep IDs, sessions, private photos and object paths out of public artifacts.

| Exercise | Required result |
| --- | --- |
| Guest request with synthetic damage image | Receipt opens in the same browser; fresh browser and unrelated guest cookie cannot read request or image |
| Customer A vehicle and request | Receipt, My Jobs and journey agree; B and signed-out sessions cannot access A's data or private images |
| Operations access | Customer and signed-out sessions denied; identified operator permitted |
| Manual expert/quote | Explicit human review, correct price/scope, no AI or payment claim |
| Quote choice and retry | Appointment requested, never confirmed; identical command replays once; changed payload with the same key fails |
| Confirmation and overlap | Explicit availability assertion required; simultaneous overlapping confirmations for one expert allow at most one |
| Invalid transitions | Expired quote, unauthorised actor, archived/transferred vehicle and premature completion denied |
| Completion evidence | Operator uploads synthetic evidence; missing or mismatched evidence cannot complete; successful completion records history exactly once |
| Account switch/sign-out | Previously loaded photos, drafts and pending commands clear; stale responses cannot repopulate private content |
| Storage direct access | Anonymous/other-customer reads denied; authorised application photo responses private/no-store |
| Completed customer path | Receipt, My Jobs, journey and Garage history agree with persisted completion |

Stop on any cross-account access, unexpected real data, public private-media object, duplicate mutation or incorrect confirmation. Preserve evidence and follow the approved recovery process. No production/main or DNS change is part of this exercise.

Only after these checks and required review pass should the staging branch be released and a phone-test link handed over as fully connected. Ravin, payments and outbound notifications remain outside this acceptance.
