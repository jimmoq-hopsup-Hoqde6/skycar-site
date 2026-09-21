# Skycar V2 foundation setup

Tracks Issue #1.

## Runtime
- Node.js 24.x
- Next.js 16.3.5
- React 19.3.0
- Supabase JS 2.116.0
- @supabase/ssr 0.12.7

Versions are intentionally exact in package.json. The dependency lockfile is committed. CI must install from it successfully before Issue #1 can close.

## Local application
1. Copy .env.example to .env.local.
2. Set SKYCAR_ENV=demo for UI-only development.
3. For authenticated/database work, create an isolated Supabase project and set the public URL and publishable key.
4. Server-owned media intake additionally requires `SUPABASE_SECRET_KEY`. Keep it
   server-only; never prefix it with `NEXT_PUBLIC_` or expose it to browser code.
5. Install dependencies with npm install.
6. Run npm run check.
7. Run npm run dev.

Do not place a Supabase secret/service key in browser code. Do not use production credentials for local development.

## Database
The first migration is supabase/migrations/202609200001_foundation.sql.
It establishes the shared profile/role/vehicle/history/media primitives and owner-scoped RLS. Apply it only to an isolated development or staging database until reviewed and tested.

Required database verification before closing Issue #1:
- new auth user receives customer role;
- user A can create/read/update own vehicle;
- user B cannot read/update/delete user A vehicle;
- user B cannot add history/media to user A vehicle;
- browser user cannot grant admin/technician/fleet roles;
- private-media object path is scoped to authenticated user ID.

## API
Versioned application endpoints begin at /api/v1. The health endpoint is /api/v1/health and does not expose secrets.

## Environments
Demo, staging and production are distinct. Production must not fall back to demo fixtures. Future modules are feature-gated server-side as they are implemented.

## Current limitation
This scaffold does not activate billing, roadside, partner offers, AI providers, Care booking or public deployment. Those modules remain disabled/gated until their own acceptance criteria are met.
