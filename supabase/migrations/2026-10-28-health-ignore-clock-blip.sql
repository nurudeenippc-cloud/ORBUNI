-- Health monitor: stop alerting on the platform's harmless clock blip.
-- Every few hours one background call (usually send-student-emails) gets a 500 "JWT issued at future":
-- Supabase's gateway signs its internal token a moment ahead of the database clock. Nothing is lost —
-- the same job runs again 2 minutes later and sends normally — but each blip paged every admin.
-- Change: the 'net' check skips responses whose body is that error. All other failures still alert.
-- Rollback: re-run supabase/migrations/2026-10-23-health-alerts.sql (create or replace).
do $$
declare def text;
begin
  def := pg_get_functiondef('public.orb_health_check()'::regprocedure);
  def := replace(def,
    'and (r.timed_out or r.status_code is null or r.status_code >= 500);',
    'and (r.timed_out or r.status_code is null or r.status_code >= 500)
         and coalesce(r.content, '''') not ilike ''%issued at future%'';');
  if position('issued at future' in def) = 0 then raise exception 'pattern not found'; end if;
  execute def;
end $$;
