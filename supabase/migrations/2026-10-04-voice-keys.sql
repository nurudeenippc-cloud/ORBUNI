-- "Hey Siri, Orbuni": personal voice keys for the staff assistant.
-- A teammate makes a key in the portal (shown once), pastes it into an iPhone
-- Shortcut, and the Shortcut asks orbuni-assistant questions with it.
-- Only a SHA-256 of the key is stored. Keys answer questions only (no drafts),
-- see the same things their owner sees, can be switched off in the portal,
-- and are capped at 60 questions an hour.

create table if not exists public.ai_voice_keys (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  key_hash     text not null unique,
  label        text not null default 'iPhone',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  hour_start   timestamptz,
  hour_count   int not null default 0
);
alter table public.ai_voice_keys enable row level security;
create policy voice_keys_own_read on public.ai_voice_keys for select to authenticated using (profile_id = auth.uid());
create policy voice_keys_own_revoke on public.ai_voice_keys for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.ai_voice_keys from anon, authenticated;
grant select (id, label, created_at, last_used_at, revoked_at) on public.ai_voice_keys to authenticated;
grant update (revoked_at) on public.ai_voice_keys to authenticated;

-- Make a key for the signed-in teammate. Returns the key once; it is never shown again.
create or replace function public.create_voice_key(p_label text default 'iPhone')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not public.is_staff() then raise exception 'Only the Orbuni team can make a voice key.' using errcode = '42501'; end if;
  if (select count(*) from ai_voice_keys where profile_id = auth.uid() and revoked_at is null) >= 5 then
    raise exception 'You already have 5 voice keys switched on. Switch one off first.';
  end if;
  k := 'orbv_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into ai_voice_keys(profile_id, key_hash, label)
  values (auth.uid(), encode(extensions.digest(k, 'sha256'), 'hex'), left(coalesce(nullif(trim(p_label), ''), 'iPhone'), 40));
  return k;
end $$;
revoke all on function public.create_voice_key(text) from public, anon;
grant execute on function public.create_voice_key(text) to authenticated;

-- Server only: who a key belongs to and what they may see. Counts the use.
create or replace function public.voice_key_identity(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r ai_voice_keys; uid uuid;
begin
  select * into r from ai_voice_keys where key_hash = p_hash and revoked_at is null;
  if not found then return null; end if;
  uid := r.profile_id;
  if r.hour_start is null or r.hour_start < now() - interval '1 hour' then
    update ai_voice_keys set hour_start = now(), hour_count = 1, last_used_at = now() where id = r.id;
  else
    if r.hour_count >= 60 then return jsonb_build_object('error', 'limit'); end if;
    update ai_voice_keys set hour_count = hour_count + 1, last_used_at = now() where id = r.id;
  end if;
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return jsonb_build_object(
    'uid', uid,
    'staff', public.is_staff(),
    'finance', public.can_manage_section('finance'),
    'ops', public.can_manage_section('ops'),
    'apps', public.can_open('apps') or public.can_manage_section('applications'),
    'owner', coalesce((select is_owner from profiles where id = uid), false));
end $$;
revoke all on function public.voice_key_identity(text) from public, anon, authenticated;
grant execute on function public.voice_key_identity(text) to service_role;
