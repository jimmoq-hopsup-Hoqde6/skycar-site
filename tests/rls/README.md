# RLS verification contract

Issue #1 cannot close until these checks run against an isolated Supabase database with two real test users.

1. User A inserts and reads vehicle A.
2. User B receives zero rows for vehicle A.
3. User B update/delete of vehicle A affects zero rows or is rejected.
4. User B cannot insert vehicle_history referencing vehicle A.
5. User B cannot insert media_assets referencing vehicle A.
6. Authenticated users can read their own user_roles but cannot insert/update/delete grants.
7. Storage object access is restricted to the authenticated user's top-level folder.

Automate these checks once CI has safe isolated Supabase credentials. Do not point them at production.
