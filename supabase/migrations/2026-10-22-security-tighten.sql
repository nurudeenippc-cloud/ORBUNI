-- The funnel watchdog is run by the scheduler only; visitors cannot trigger it.
revoke execute on function public.funnel_health() from public, anon, authenticated;

-- "Already registered → go VIP": both the email and the WhatsApp number must match the seat,
-- so nobody can flag someone else's seat (which would start VIP reminder messages to them).
create or replace function public.webinar_dup_upgrade(p_id text, p_email text, p_phone text) returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_email text := nullif(lower(trim(coalesce(p_email,''))), ''); v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g'); r record;
begin
  if v_email is null or char_length(v_digits) < 7 then return null; end if;
  select * into r from public.webinar_registrations g
   where g.webinar_id = p_id and lower(g.email) = v_email
     and regexp_replace(coalesce(g.phone,''), '\D', '', 'g') = v_digits limit 1;
  if r.id is null then return null; end if;
  if r.ticket = 'vip' then return 'vip'; end if;
  update public.webinar_registrations set vip_checkout_at = coalesce(vip_checkout_at, now()) where id = r.id;
  return 'free';
end $function$;
