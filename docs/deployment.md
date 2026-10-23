# Orbuni — deployment, verification and rollback

## Website (Netlify)
- Deploy = upload the `site/` folder to Netlify site `effortless-churros-4b9097` (drag-and-drop, or the Netlify MCP direct deploy).
- Before: run the checks in `docs/development.md`.
- After: open myorbuni.com, sign in as a test student and a test staff account, open Applications and Documents, check the browser console has no red errors.
- **Rollback**: Netlify → Deploys → pick the previous deploy → "Publish deploy". Instant; does not touch the database.

## Edge functions (Supabase)
- Deploy one function at a time from `supabase/functions/<name>` with the Supabase CLI or MCP. `supabase/config.toml` keeps `verify_jwt` as it is live — **never deploy webhook/cron functions with verify_jwt = true**, or Twilio, Paystack, Whop and pg_cron calls will be rejected.
- After: check the function's logs for 5xx for 10 minutes; for WhatsApp send yourself a message; for payments use the `x-orb-secret` self-test.
- **Rollback**: redeploy the previous version from git history (`git show <commit>:supabase/functions/<name>/index.ts`).

## Database
- Additive migrations only, applied through Supabase migrations; old and new site versions must both work during the switch (add columns before code uses them; remove only after nothing reads them).
- **There is no verified restorable backup on the Free plan.** Take a dump before any migration that changes or deletes data.
- No non-production database exists (no Supabase branches). Read-only checks (like `rls_isolation.sql`) are safe on production; anything that writes needs approval.

## Not automated
There is no CI. GitHub is the record; Netlify is not linked to the repo, so nothing deploys on push.
