-- 5 Nov 2026: two blind spots in the monitor.
-- 1. Errors in visitors' browsers: the site now reports uncaught errors to client_errors
--    (anyone may insert, rate-limited per connection; only staff can read).
-- 2. Is myorbuni.com up? A job requests the home page every 5 minutes (ops_uptime keeps the
--    request ids); orb_health_check alerts when 2 or more of them failed since its last run.
-- orb_health_check gets two new checks, 'site' and 'client', in the same alert as the others.
-- Rollback: select cron.unschedule('orb-uptime'); delete from ops_health_state where check_key
-- in ('site','client'); re-run 2026-11-01-health-whatsapp-capped.sql after
-- 2026-10-29-health-quiet-blips.sql; drop table client_errors, ops_uptime.

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  page text, message text not null, source text, line int, ua text, session_id text
);
create index if not exists client_errors_at on public.client_errors (at desc);
alter table public.client_errors enable row level security;
drop policy if exists "anyone reports an error" on public.client_errors;
create policy "anyone reports an error" on public.client_errors for insert to anon, authenticated
  with check (length(message) between 1 and 500 and coalesce(length(page), 0) <= 300
    and coalesce(length(source), 0) <= 300 and coalesce(length(ua), 0) <= 300 and coalesce(length(session_id), 0) <= 64);
drop policy if exists "staff read errors" on public.client_errors;
create policy "staff read errors" on public.client_errors for select using (is_staff());
grant insert on public.client_errors to anon, authenticated;
grant select on public.client_errors to authenticated;
drop trigger if exists rate_guard_client_errors on public.client_errors;
create trigger rate_guard_client_errors before insert on public.client_errors
  for each row execute function rate_guard('client_error', '30', '3000');

create table if not exists public.ops_uptime (req_id bigint primary key, at timestamptz not null default now());
alter table public.ops_uptime enable row level security;   -- no policies: server only

insert into public.ops_health_state (check_key, watermark) values ('site', now()), ('client', now())
  on conflict (check_key) do nothing;

do $$ declare def text; begin
  def := pg_get_functiondef('public.orb_health_check()'::regprocedure);
  def := replace(def, $a$      if n >= 3 then detail := n || ' WhatsApp message(s) failed to send'; end if;
    end if;$a$, $a$      if n >= 3 then detail := n || ' WhatsApp message(s) failed to send'; end if;
    elsif st.check_key = 'site' then
      select count(*) into n from public.ops_uptime u left join net._http_response r on r.id = u.req_id
       where u.at > st.watermark and u.at <= now_ts - interval '1 minute'
         and (r.id is null or r.timed_out or r.status_code is null or r.status_code >= 400);
      if n >= 2 then detail := 'myorbuni.com did not load in ' || n || ' check(s) (checked every 5 minutes)'; end if;
      delete from public.ops_uptime where at < now_ts - interval '2 days';
    elsif st.check_key = 'client' then
      select count(*), (select e.message from public.client_errors e where e.at > st.watermark and e.at <= now_ts
                         group by e.message order by count(*) desc limit 1)
        into n, detail
        from public.client_errors c where c.at > st.watermark and c.at <= now_ts;
      if n >= 5 then detail := n || ' error(s) in visitors'' browsers. Most common: ' || left(detail, 160);
      else detail := null; end if;
    end if;$a$);
  if position('st.check_key = ''site''' in def) = 0 then
    raise exception 'orb_health_check: expected text not found, nothing changed';
  end if;
  execute def;
end $$;

select cron.unschedule('orb-uptime') where exists (select 1 from cron.job where jobname = 'orb-uptime');
select cron.schedule('orb-uptime', '*/5 * * * *',
  $c$insert into public.ops_uptime (req_id) select net.http_get(url := 'https://myorbuni.com/?uptime=1', timeout_milliseconds := 15000)$c$);
