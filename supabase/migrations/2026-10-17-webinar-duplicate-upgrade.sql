-- Someone who signs up again with an email or number that already has a seat used to land on a dead-end
-- ("You already have a seat") with no VIP offer. Now:
--   * webinar_register also says which ticket the existing seat has (still never reveals the private seat link);
--   * webinar_dup_upgrade(p_id, p_email, p_phone) starts the VIP upgrade for that seat. It returns only
--     'free' / 'vip' / null and exposes nothing. The payment is matched to the seat by the same email
--     (webinar_sync_vip), exactly like the normal upgrade.
-- (webinar_register's full body is in 2026-10-14-webinar-funnel.sql; the only change is v_dticket and the duplicate return.)
create or replace function public.webinar_dup_upgrade(p_id text, p_email text, p_phone text)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_email text := nullif(lower(trim(coalesce(p_email,''))), ''); v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g'); r record;
begin
  select * into r from public.webinar_registrations g
   where g.webinar_id = p_id and ((v_email is not null and lower(g.email) = v_email)
         or (char_length(v_digits) >= 7 and regexp_replace(coalesce(g.phone,''), '\D', '', 'g') = v_digits)) limit 1;
  if r.id is null then return null; end if;
  if r.ticket = 'vip' then return 'vip'; end if;
  update public.webinar_registrations set vip_checkout_at = coalesce(vip_checkout_at, now()) where id = r.id;
  return 'free';
end $fn$;
revoke all on function public.webinar_dup_upgrade(text,text,text) from public;
grant execute on function public.webinar_dup_upgrade(text,text,text) to anon, authenticated;
