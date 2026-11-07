-- Applied 23 Oct 2026. Keep pg_cron's run log to 7 days (job logs only, not business data).
-- Rollback: select cron.unschedule('orb-cron-log-trim');
select cron.schedule('orb-cron-log-trim', '40 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
