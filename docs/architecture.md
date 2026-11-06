# Orbuni — architecture (as found on 23 Oct 2026)

## Pieces
| Part | What it is | Where |
|---|---|---|
| Website + portals | One static single-page app (`site/index.html`, ~38,800 lines) plus prerendered public pages. No build step. Talks to Supabase from the browser with the **publishable** key; RLS decides what each person sees. | `site/` → Netlify site `effortless-churros-4b9097` (myorbuni.com) |
| Database | Supabase Postgres 17 (`ytsebzdykfeiiuxbdtvr`, eu-central-1, **Free plan**). ~120 tables, RLS on every exposed table, ~70 security-definer RPCs, 12 storage buckets. | Supabase |
| Server code | 38 Deno edge functions (webhooks, AI, payments, email, WhatsApp, invites). | `supabase/functions/` (all 38 now in the repo; see note below) |
| Scheduled work | 15 `pg_cron` jobs; most call edge functions through `pg_net` with an `x-orb-secret` header. | database (`cron.job`) |
| Integrations | Twilio WhatsApp, Anthropic (AI replies + assistant), Resend (email), Whop + Paystack (payments), Google/Microsoft OAuth (calendars), AskUni bot (Render), Cloudflare (DNS/Turnstile). | edge functions only — keys never reach the browser |

## Critical workflows and where each lives
- **Sign-up / login**: Supabase Auth; `handle_new_user()` trigger creates the profile and claims pending students/partners. New student self sign-up is paused server-side.
- **Student profile, documents, applications**: tables `profiles`, `student_details`, `documents`, `applications`, `application_events`; files in private bucket `documents/<profile_id>/…`. RLS: owner, their counsellor/staff with the section, their partner.
- **Partner access**: `profiles.partner_id`; partners see only students whose profile carries their `partner_id` (+ `pending_students` they created).
- **Team access**: role `admin`/`staff` + per-section grants (`section_access`, `can_open()`, `can_manage_section()`).
- **Payments**: Whop (USD) via `whop-checkout` + `whop-sync` (cron + webhook), Paystack (NGN) via `paystack` (HMAC-verified webhook, server-side prices). Source of truth: `whop_payments`, `paystack_payments`, `student_orders`, `finance_transactions`.
- **WhatsApp**: Twilio → `wa-webhook` (signature-checked, dedup by MessageSid) → `wa_messages`; AI reply in the background; `wa-send` for staff; `wa-followups`, `wa-templates`, `webinar-followups` on cron.
- **Email**: rows queued in `email_outbox`, sent by `send-student-emails` every 2 min with back-off; `send-manual-email` for staff one-offs; `email-optout` HMAC links.
- **AI**: `orbuni-assistant` (portal, role-limited tools, proposals need a human click), WhatsApp agent inside `wa-webhook`.

## Source of truth notes
- **Database schema**: the live database is the source of truth. `supabase/migrations/` holds only the changes made since 3 Oct 2026 (26 files); the earlier ~190 migrations exist only in the live migration history. Before rebuilding a database from this repo, dump the live schema first (`supabase db dump`).
- **Edge functions**: 18 functions existed only in Supabase until 23 Oct 2026; their deployed source was copied into the repo then. `google-form-project-response` is deliberately NOT in the repo because its deployed copy contains a hard-coded secret (see `docs/security.md`).
- `supabase/config.toml` records each function's live `verify_jwt` setting so a CLI deploy cannot silently change it.
