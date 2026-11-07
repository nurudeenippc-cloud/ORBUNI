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

## Monitoring and alerts (since 23 Oct 2026)
- `orb_health_check()` runs every 15 minutes (cron `orb-health-check`). New failed cron runs, failed or timed-out server calls from the database, failed WhatsApp sends, and emails stuck after 3+ attempts raise one **"System alert"** to every admin. It arrives as a phone push, an email and a WhatsApp message.
- The same problem alerts at most once an hour; stuck emails at most every 6 hours. State lives in `ops_health_state`.
- Test it safely: `do $$ begin update ops_health_state set watermark = now() - interval '7 days'; raise exception '%', orb_health_check(); end $$;`. This rolls back, so nothing is sent.

## Known gaps
- **Backups: not verified.** The organisation is on the **Free plan**; Supabase does not provide restorable backups or point-in-time recovery on Free. Until that changes, take a manual dump (`supabase db dump --data-only` and schema) at least weekly and keep it off-site, or upgrade to Pro (daily backups, 7 days).
- Free projects can be paused after a week without API traffic; the cron jobs make that unlikely but it is not guaranteed.
- Internal alerts exist (above), but there is no uptime monitor outside Supabase. A free external ping (e.g. UptimeRobot on `https://myorbuni.com` and the `wa-health` function) would catch outages.
- Outbound calls in the money and messaging functions now give up after 20 s (whop-sync, whop-checkout, paystack-to-whop, payment-receipts, send-alerts, send-student-emails, lead-instant, webinar-followups, book-call; in the repo, deployed through the deploy workflow). The rest (WhatsApp helper copies, admin tools) still have none.
- `finance-write` records each manual entry once: the portal sends a `request_id` and a unique index on `finance_transactions.client_request_id` blocks repeats (live 23 Oct 2026).
- `send-student-emails` now claims each row with a 10-minute lease before sending and passes an `Idempotency-Key` to Resend, so overlapping runs cannot send an email twice (in the repo; ships with the next deploy of that function).
- The WhatsApp helper `wa.ts` is copied into 6 function folders; `wa-send`, `wa-followups` and `webinar-followups` copies have drifted from `_wa/wa.ts`. Move to `supabase/functions/_shared/` before the next WhatsApp change.

## Weekly health review
1. `get_advisors` (security + performance) — compare with last week.
2. Cron failures: `select jobname, count(*) filter (where status='failed') from cron.job_run_details join cron.job using (jobid) where start_time > now()-interval '7 days' group by 1;`
3. Edge errors: function logs filtered to status ≥ 500.
4. Run `supabase/tests/rls_isolation.sql` — must say PASS.
5. `email_outbox` unsent / failing counts; WhatsApp failed sends (`wa_messages.status = 'failed'`).
6. Database size vs 500 MB; Anthropic and Twilio spend in their dashboards.
