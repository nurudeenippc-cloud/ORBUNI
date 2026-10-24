# Orbuni — security

## Model
- The browser only ever holds the Supabase **publishable** key. Everything a person can read or change is decided by Postgres RLS and security-definer functions that check `auth.uid()`.
- Server secrets (Twilio, Anthropic, Resend, Whop, Paystack, service-role key, cron secret) live only in Supabase Edge Function secrets. `tools/check_site.mjs` fails if one appears in `site/`.
- Edge functions with `verify_jwt = false` must do their own check: webhook signature (Twilio HMAC-SHA1, Paystack HMAC-SHA512), `x-orb-secret` for cron/self-tests, or `auth.getUser()` + role/section RPC for portal calls. The live settings are pinned in `supabase/config.toml`.

## Verified on 23 Oct 2026 (evidence, not assumption)
- **Data isolation** — `supabase/tests/rls_isolation.sql` impersonates anon, all 9 students and both partners: 88 checks, PASS. Students see only their own documents, applications, payments, agreements, details and files (plus staff avatars); partners see only their own students; anon sees only the public catalogue (programmes, universities, public videos, housing, public feed posts, public Whop product ids).
- **Storage**: private buckets for documents, CVs, chat, WhatsApp media, partner docs. Public buckets: `article-images`, `housing`, `site-media` (intended).
- **Webhooks**: `wa-webhook` verifies the Twilio signature (now constant-time, with tests against Twilio's published example); `paystack` verifies HMAC-SHA512 in constant time and re-verifies amount + currency with Paystack before settling.
- **No secrets in the repository or the website files** (scan in `tools/check_site.mjs` + manual grep of `supabase/`).

## Open items (need the owner)
1. **`google-form-project-response` has its webhook secret hard-coded in the deployed source** and also accepts it as a URL query parameter. Anyone with the secret can add tester responses and create upload URLs in `growth-project-videos` (300 MB each). Fix: put a new secret in Edge Function secrets (`FORM_WEBHOOK_SECRET`), read it with `Deno.env.get`, accept it only in the header, update the Google Form script, redeploy, then retire the old value. Do not paste the current value anywhere.
2. **Leaked-password protection is off** (Auth → Passwords). It may need a paid plan.
3. **5 security-definer views** (`articles_public`, `scholarship_offers`, `university_videos_public`, `housing_listings_public`, `open_channels`) — reviewed: each exposes only public columns/rows or checks `is_staff()`. Accepted; revisit if columns are added.
4. **~25 anon-callable security-definer RPCs** — reviewed the money/identity ones (`webinar_*`, `lead_reserve`, `accept_agreement`): guarded by unguessable tokens, matching email+phone, or a real paid payment. Exception: `lead_reserve` lets anyone who knows a phone number mark that lead "reserved" (low impact; proposal in `supabase/proposed/`).
5. No `script-src` Content-Security-Policy (inline scripts would need hashes). User text is escaped with `esc()` before `innerHTML`; unescaped interpolations found were static data.
6. Four retired stub functions are still deployed (`env-check`, `media-import`, `set-team-photo`, `askuni-debug-shot`, all return 410). Safe to delete from the dashboard.

## If a secret leaks
Rotate it at the provider, update the Supabase secret, redeploy the functions that read it, then check the provider's logs for use of the old one. Never commit the value.
