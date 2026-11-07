-- A phone's push endpoint belongs to whoever is signed in on it now.
-- When a device that was used by another account (e.g. staff testing a student login)
-- re-subscribes, the plain upsert hits the old owner's row and RLS blocks the UPDATE.
-- This function moves the device to the caller. Endpoints are unguessable per-browser
-- URLs, so only the browser that holds one can claim it.
create or replace function public.claim_push_device(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh),0) not between 20 and 200
     or coalesce(length(p_auth),0) not between 8 and 100 then
    raise exception 'invalid push subscription';
  end if;
  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, fail_count = 0;
end $$;

revoke all on function public.claim_push_device(text, text, text, text) from public, anon;
grant execute on function public.claim_push_device(text, text, text, text) to authenticated;
