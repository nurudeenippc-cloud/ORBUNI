# Orbuni — reliability and operations

## What protects against what (verified 23 Oct 2026)
| Failure | Current behaviour |
|---|---|
| Twilio retries a WhatsApp webhook | dedup by `MessageSid` + unique index `wa_messages_twilio_sid_key` |
| Paystack webhook delivered twice | settles only `pending` rows; unique `paystack_payments.reference` |
| Whop payment seen by webhook and cron | upsert on Whop payment id (primary key) |
| Webinar form submitted twice | unique (webinar, email) and (webinar, phone digits) |
| Email provider down | `email_outbox` rows retried with back-off (`next_try_at`, `attempts`), stalled rows revived by `orb-email-revive` |
| Lead / signup flood | `rate_guard` (10/IP/h, 3,000/h global for webinar) and `guard_lead_flood` (240 per 5 min) |
| Clock skew on a user's computer | portal rewrites token expiry (`clockSkewGuard`) so sign-in is not lost |

## Health right now
- Cron: 15 jobs, **0 failures in the last 7 days**; all `pg_net` calls in the last 24 h returned 200.
- Edge functions (24 h): `send-student-emails` returned 500 five times (queue read failed); nothing stuck in `email_outbox` (0 unsent). The repo version now logs the error text so the next one is diagnosable (takes effect on next deploy).
- Database 47 MB of 500 MB; of that, 19 MB is the cron run log (proposal to trim it in `supabase/proposed/`).

## Known gaps
- **Backups: not verified.** The organisation is on the **Free plan**; Supabase does not provide restorable backups or point-in-time recovery on Free. Until that changes, take a manual dump (`supabase db dump --data-only` and schema) at least weekly and keep it off-site, or upgrade to Pro (daily backups, 7 days).
- Free projects can be paused after a week without API traffic; the cron jobs make that unlikely but it is not guaranteed.
- No uptime monitor outside Supabase. A free external ping (e.g. UptimeRobot on `https://myorbuni.com` and the `wa-health` function) would catch outages.
- Most outbound `fetch` calls in edge functions have no timeout (Paystack FX and AskUni do). A hung provider holds the function until the platform limit.
- `finance-write` has no idempotency key: a double click records two ledger rows.
- `send-student-emails` runs every 2 min with no row claim; if one run ever takes longer than 2 min, the next run could send the same email again.
- The WhatsApp helper `wa.ts` is copied into 6 function folders; `wa-send`, `wa-followups` and `webinar-followups` copies have drifted from `_wa/wa.ts`. Move to `supabase/functions/_shared/` before the next WhatsApp change.

## Weekly health review
1. `get_advisors` (security + performance) — compare with last week.
2. Cron failures: `select jobname, count(*) filter (where status='failed') from cron.job_run_details join cron.job using (jobid) where start_time > now()-interval '7 days' group by 1;`
3. Edge errors: function logs filtered to status ≥ 500.
4. Run `supabase/tests/rls_isolation.sql` — must say PASS.
5. `email_outbox` unsent / failing counts; WhatsApp failed sends (`wa_messages.status = 'failed'`).
6. Database size vs 500 MB; Anthropic and Twilio spend in their dashboards.
