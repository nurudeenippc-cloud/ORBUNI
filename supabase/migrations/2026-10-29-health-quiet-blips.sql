-- 29 Oct 2026: the monitor still sent a WhatsApp for single network blips.
-- About 3 in 500 scheduled calls a day fail once and succeed on the next run two minutes
-- later, so one failure is not a problem. Now:
--   * server calls: only 3 or more failures since the last check count
--   * WhatsApp sends: only 3 or more failures count
--   * the alert is kind 'system_alert', which send-alerts delivers by email and push only,
--     never WhatsApp (WhatsApp stays for people: handoffs, leads, payments, team messages)
-- Scheduled-job failures and stuck emails still alert on the first one, as before.
-- Rollback: re-run 2026-10-28-health-ignore-clock-blip.sql.
alter type public.notif_kind add value if not exists 'system_alert';

do $$ declare def text; begin
  def := pg_get_functiondef('public.orb_health_check()'::regprocedure);
  def := replace(def, $a$if n > 0 then detail := n || ' server call(s) from scheduled jobs failed or timed out'; end if;$a$,
                      $a$if n >= 3 then detail := n || ' server call(s) from scheduled jobs failed or timed out'; end if;$a$);
  def := replace(def, $a$if n > 0 then detail := n || ' WhatsApp message(s) failed to send'; end if;$a$,
                      $a$if n >= 3 then detail := n || ' WhatsApp message(s) failed to send'; end if;$a$);
  def := replace(def, $a$values ('team_alert', 'System alert: something needs a look',$a$,
                      $a$values ('system_alert', 'System alert: something needs a look',$a$);
  if position('n >= 3 then detail := n || '' server' in def) = 0
     or position('n >= 3 then detail := n || '' WhatsApp' in def) = 0
     or position('''system_alert''' in def) = 0 then
    raise exception 'orb_health_check: expected text not found, nothing changed';
  end if;
  execute def;
end $$;
