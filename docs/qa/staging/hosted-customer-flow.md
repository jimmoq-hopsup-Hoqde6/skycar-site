# Hosted customer-flow verification — 1 October 2026

Verified against the protected isolated Skycar staging preview, application revision `1192d7436c5562bd1d121ae575c2839b7140438f`.

PASS: confirmed disposable customer A signs in; Garage loads; a synthetic 2020 Toyota vehicle saves; repair request submits; status displays the recorded receipt and next-update deadline; My Jobs lists that same request. Read-only database checks confirm exactly one matching synthetic vehicle and one matching synthetic request.

The first sign-in attempt reached Supabase but returned `invalid_credentials`; successful sign-in followed when the owner used the correct test-account credentials. No credentials were retrieved or recorded.

Pending: disposable customer B does not yet exist, so cross-account hosted privacy verification is not complete. Actual phone verification remains pending. Photo storage and audited upload API are installed, but the current Garage UI has no photo upload control; no hosted photo upload or display acceptance is claimed. Care requests record review progress and do not confirm booking, pricing, coverage, technicians, fulfilment or payment.
