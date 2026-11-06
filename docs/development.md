# Orbuni — development and checks

## Checks to run before every release
```bash
node tools/check_site.mjs                                   # every inline script parses; no secrets in site/
cd supabase/functions
deno check --no-lock */index.ts                             # type-check all 38 edge functions
deno lint                                                   # config in deno.json (no-explicit-any is off: house style)
deno test --allow-env --no-lock _wa/wa_test.ts              # Twilio signature + phone helpers
```
Database isolation (read-only, always rolls back): paste `supabase/tests/rls_isolation.sql` into the Supabase SQL editor → must end with `RLS_ISOLATION PASS`.

## Conventions
- Site: plain JS inside `site/index.html`; escape anything a person typed with `esc()` before it goes into `innerHTML`.
- Edge functions: read secrets with `Deno.env.get`; never echo provider errors without the `scrub()` helper; answer `OPTIONS`; return friendly `{ error }` JSON.
- Database: additive migrations only, saved in `supabase/migrations/YYYY-MM-DD-name.sql`; RLS on every new table; security-definer functions with `set search_path = public` and an explicit `revoke … from public, anon` where they are not public.
- Anything destructive goes to `supabase/proposed/` first and waits for approval.
