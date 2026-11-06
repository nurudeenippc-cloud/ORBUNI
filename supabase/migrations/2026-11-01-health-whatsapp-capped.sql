-- 1 Nov 2026: the owners do want system alerts on WhatsApp, just not 36 in two weeks.
-- Now the first alert goes to WhatsApp (kind 'team_alert'), and any more within 6 hours
-- go by email and push only (kind 'system_alert'). Every alert still goes to every admin.
-- Rollback: re-run 2026-10-29-health-quiet-blips.sql.
do $$ declare def text; begin
  def := pg_get_functiondef('public.orb_health_check()'::regprocedure);
  def := replace(def, $a$values ('system_alert', 'System alert: something needs a look',$a$,
    $a$values (case when exists (select 1 from public.notifications x where x.kind = 'team_alert'
                 and x.payload->>'source' = 'orb_health_check' and x.created_at > now_ts - interval '6 hours')
               then 'system_alert'::public.notif_kind else 'team_alert'::public.notif_kind end,
            'System alert: something needs a look',$a$);
  if position('then ''system_alert''::public.notif_kind' in def) = 0 then
    raise exception 'orb_health_check: expected text not found, nothing changed';
  end if;
  execute def;
end $$;
