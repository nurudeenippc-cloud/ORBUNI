-- Team WhatsApp assistant (7 Nov 2026).
-- When a team member messages the Orbuni WhatsApp number, the webhook hands the message to the
-- team assistant (orbuni-assistant) acting as that person, instead of the student AI.
-- Both functions are for the service role only (the edge functions); nobody can call them from the browser.

-- Which team member owns this WhatsApp number (matched on the last 9 digits, so +90 / 0 / spaces don't matter).
create or replace function public.staff_by_phone(p_phone text)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.role in ('staff'::user_role, 'admin'::user_role)
     and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
     and right(regexp_replace(p_phone, '\D', '', 'g'), 9) in (
           right(regexp_replace(coalesce(p.whatsapp, ''), '\D', '', 'g'), 9),
           right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9))
   order by p.is_owner desc nulls last
   limit 1
$$;

-- The same permissions the portal gives this person (like voice_key_identity, without a key).
create or replace function public.staff_identity(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare own boolean;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  own := coalesce((select is_owner from profiles where id = p_uid), false);
  return jsonb_build_object(
    'uid', p_uid,
    'staff', public.is_staff(),
    'admin', coalesce((select role = 'admin'::user_role from profiles where id = p_uid), false),
    'finance', public.can_open('finance'),
    'ops', public.can_open('ops'),
    'marketing', public.can_open('marketing'),
    'content', public.can_open('content'),
    'apps', public.can_open('apps') or public.can_manage_section('applications'),
    'team', own or public.can_manage_section('leads'),
    'owner', own);
end $$;

revoke all on function public.staff_by_phone(text) from public, anon, authenticated;
revoke all on function public.staff_identity(uuid) from public, anon, authenticated;
grant execute on function public.staff_by_phone(text) to service_role;
grant execute on function public.staff_identity(uuid) to service_role;
