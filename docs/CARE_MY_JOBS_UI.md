# Garage-linked My Jobs UI

The authenticated `/garage/jobs` page consumes the versioned
`GET /api/v1/care/requests` contract from `CARE_MY_JOBS_API.md` and links each
summary to the existing `/care/requests/:id` receipt/timeline page. The Garage
navigation exposes My Jobs without changing authoritative Care state.

## Display boundary

- Shows only the implemented request-received, delayed/overdue and no-match
  states returned by the server.
- Shows the server-owned next action, responsible role, next-update deadline,
  overdue result and archived-vehicle history label.
- Uses the Garage API to label owned vehicles and to filter by active or archived
  vehicle ID. A missing label falls back to “Your vehicle”; it never exposes an
  owner ID.
- Loads bounded cursor pages and passes the opaque cursor unchanged. Refresh and
  vehicle changes restart at the first page.
- Does not create pending/upcoming/past booking groups or imply a technician,
  appointment, quote, price or payment.

## Privacy and recovery

Both Garage and Care requests use same-origin credentials and `no-store`.
Unauthenticated, forbidden, invalid-cursor and not-found responses immediately
discard request pages, vehicle labels and cursors. Returning to the page or
refocusing it also discards and reloads private state, preventing an earlier
account's cached list from surviving a sign-out/account change. Transient
network/server failures retain a clearly labelled last-verified list with an
explicit retry action.

## Synthetic acceptance evidence

After `npm run build`, run:

```sh
PLAYWRIGHT_MODULE=<playwright-module> CHROMIUM_PATH=<chromium-binary> node tests/ui/care-my-jobs.mjs
```

The intercepted fixtures contain no customer data and cover loading, list,
vehicle filtering, archived history, cursor pagination, stale retry, session
redaction, empty and access-denied states at 1440×1000 and 390×844.

- [Desktop list](qa/care-my-jobs/desktop-list.png)
- [Mobile archived filter](qa/care-my-jobs/mobile-archived-filter.png)
- [Mobile stale retry](qa/care-my-jobs/mobile-stale-retry.png)
- [Mobile session required](qa/care-my-jobs/mobile-session-required.png)

These are synthetic browser checks, not hosted Supabase, real-account or
physical-device evidence. Hosted session/PostgREST/private-storage and signed-in
device verification remain release gates.
