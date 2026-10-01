# Test-version fixes — 1 October 2026

The home page now opens guest service requests as its main action. Sign-in also links to the guest form. Garage and My Jobs service links open `/care/request/garage`, so requests using saved vehicles remain attached to the account and appear in My Jobs.

Guest retries retain their original key and payload after any uncertain result, even if a later retry receives a definite rejection. A later rejection cannot establish whether an earlier request saved successfully. A definite first failure still allows editing.

Photo reservation credential rejections return a safe, non-retryable configuration response before storage is reached. Rejections after storage/finalization remain retryable. The photo form retains exact uploads after uncertain results, shows the selected filename after account verification remounts the input, and offers reload/sign-in recovery if vehicle verification fails. Verification and upload calls have bounded timeouts.

Verified locally: lint, TypeScript, 164 unit tests and optimized production build. Browser fixtures at 390 × 844 verified guest entry, editable initial rejection, lost-response/rejected retry sequence and confirmed receipt; photo verification reload, initial rejection, exact retry sequence and private receipt; and Garage → saved-vehicle request → My Jobs → same request → overdue status with exactly one submission. No page exceptions occurred in the recovery fixtures. Browser fixtures use synthetic API responses and do not prove live Supabase storage.

Live acceptance remains blocked. The connected Vercel account returned no teams and denied access to the protected staging deployment. The last hosted guest/photo tests received Supabase HTTP 401 for the configured server key. A read-only staging check during this turn returned zero guest requests, media assets and storage objects.

Required configuration action: replace `SUPABASE_SECRET_KEY` on Vercel project `skycar-v2-staging` with that staging Supabase project's secret API key, retaining Preview scope for `fix/phone-test-delivery`, then redeploy. Reconnect Vercel with access to this project and its team to permit live acceptance verification. Do not send credentials through chat or commit them. Production remains outside this test work.
