-- System health alerts (additive). Every 15 minutes orb_health_check() looks for new problems
-- since its last run and, if it finds any, sends one "team_alert" notification to every admin.
-- send-alerts then delivers it as phone push, email and WhatsApp (team_alert is an urgent kind).
-- Checks:
--   1. pg_cron jobs that failed
--   2. server calls made by the database (pg_net) that returned 5xx or timed out
--   3. emails stuck after 3+ failed attempts
--   4. WhatsApp messages that failed to send
-- The same kind of problem alerts at most once an hour (stuck emails: once every 6 hours).
-- Rollback: select cron.unschedule('orb-health-check'); drop function public.orb_health_check(); drop table public.ops_health_state;

create table if not exists public.ops_health_state (
  check_key   text primary key,
  watermark   timestamptz not null default now(),   -- problems after this moment are "new"
  last_alert  timestamptz
);
alter table public.ops_health_state enable row level security;   -- no policies: server-side only
revoke all on public.ops_health_state from anon, authenticated;

insert into public.ops_health_state(check_key) values ('cron'), ('net'), ('email'), ('whatsapp')
on conflict do nothing;

create or replace function public.orb_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts  timestamptz := now();
  lines   text[] := '{}';
  st      record;
  n       int;
  detail  text;
  nid     uuid;
  alerted text[] := '{}';
begin
  for st in select * from public.ops_health_state for update loop
    n := 0; detail := null;
    if st.check_key = 'cron' then
      select count(*), string_agg(distinct j.jobname, ', ')
        into n, detail
        from cron.job_run_details d join cron.job j using (jobid)
       where d.status = 'failed' and d.end_time > st.watermark and d.end_time <= now_ts;
      if n > 0 then detail := n || ' scheduled job run(s) failed: ' || detail; end if;
    elsif st.check_key = 'net' then
      select count(*) into n from net._http_response r
       where r.created > st.watermark and r.created <= now_ts
         and (r.timed_out or r.status_code is null or r.status_code >= 500);
      if n > 0 then detail := n || ' server call(s) from scheduled jobs failed or timed out'; end if;
    elsif st.check_key = 'email' then
      -- an ongoing condition, not an event: counts what is stuck right now (last 3 days)
      select count(*) into n from public.email_outbox o
       where o.sent_at is null and o.attempts >= 3 and o.created_at > now_ts - interval '3 days';
      if n > 0 then detail := n || ' email(s) still unsent after 3+ attempts'; end if;
    elsif st.check_key = 'whatsapp' then
      select count(*) into n from public.wa_messages m
       where m.status = 'failed' and m.created_at > st.watermark and m.created_at <= now_ts;
      if n > 0 then detail := n || ' WhatsApp message(s) failed to send'; end if;
    end if;

    -- quiet window: events (cron, net, whatsapp) 1 hour; the stuck-email condition 6 hours
    if detail is not null and (st.last_alert is null or st.last_alert < now_ts -
        case when st.check_key = 'email' then interval '6 hours' else interval '1 hour' end) then
      lines := lines || detail;
      alerted := alerted || st.check_key;
      update public.ops_health_state set watermark = now_ts, last_alert = now_ts where check_key = st.check_key;
    elsif detail is null then
      update public.ops_health_state set watermark = now_ts where check_key = st.check_key;
    end if;
    -- a problem inside the 1-hour quiet window keeps its watermark, so it is reported in the next alert
  end loop;

  if array_length(lines, 1) > 0 then
    insert into public.notifications(kind, title, body, payload)
    values ('team_alert', 'System alert: something needs a look',
            array_to_string(lines, E'\n') || E'\nCheck Supabase logs (Edge Functions / Cron). — Orbuni monitor',
            jsonb_build_object('source', 'orb_health_check', 'checks', alerted))
    returning id into nid;
    insert into public.notification_recipients(notification_id, profile_id)
    select nid, p.id from public.profiles p where p.role = 'admin';
  end if;

  return jsonb_build_object('alerted', alerted, 'lines', lines);
end $$;

revoke all on function public.orb_health_check() from public, anon, authenticated;

select cron.schedule('orb-health-check', '*/15 * * * *', $$select public.orb_health_check()$$);
