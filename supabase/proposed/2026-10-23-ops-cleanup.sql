-- PROPOSED — NOT APPLIED. Needs the owner's explicit approval before it runs.
-- Each part is independent; run them one at a time in the Supabase SQL editor.
--
-- ---------------------------------------------------------------------------
-- Part 1. APPLIED 23 Oct 2026 (see migrations/2026-10-23-ops-cron-log-trim.sql).
-- Keep pg_cron's run log to 7 days (purges job LOGS, not business data).
-- Why: cron.job_run_details has ~112,000 rows (19 MB of a 47 MB database, Free
-- plan limit 500 MB) and grows by ~16,000 rows a week; nothing reads rows older
-- than a few days. Rollback: unschedule the job (select cron.unschedule('orb-cron-log-trim')).
-- Old log rows cannot be restored once deleted — they are run logs only.
-- ---------------------------------------------------------------------------
select cron.schedule('orb-cron-log-trim', '40 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- ---------------------------------------------------------------------------
-- Part 2. APPROVED by the owner 23 Oct 2026, but the Supabase connector's delete gate
-- blocks it from the AI: paste these lines in the SQL editor. Remove the 500 load-test sign-ups and the load-test helper tables
-- (created 22 Oct 2026 for the 500-signup test). DESTRUCTIVE: check the counts
-- first; both deletes only match rows the test created.
-- ---------------------------------------------------------------------------
-- check first:
-- select count(*) from public.webinar_registrations where utm_source = 'loadtest' and email like 'loadtest-%@example.test';  -- expect 500
-- delete from public.webinar_registrations where utm_source = 'loadtest' and email like 'loadtest-%@example.test';
-- drop table if exists public._loadtest_reqs, public._lt_probe, public._orb_ddl_probe;

-- ---------------------------------------------------------------------------
-- Part 3. Make lead_reserve() harder to misuse (currently anyone who knows a
-- phone number can flag that lead as "reserved" within 12 h of sign-up).
-- Additive and backward compatible: same signature, now requires BOTH the phone
-- and the email to match when both were given at sign-up. Rollback: re-create the
-- previous body (kept in the live database's migration history).
-- Not written yet on purpose — needs a decision on whether the quiz always sends both.
-- ---------------------------------------------------------------------------
