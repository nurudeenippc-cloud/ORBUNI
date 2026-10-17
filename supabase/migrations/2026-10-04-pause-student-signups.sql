-- 4 Oct 2026: pause NEW student accounts while the admission gate is built.
-- Existing accounts (students, partners, team) sign in as normal. Team invites
-- and approved partners can still create accounts. Reopen with:
--   update public.app_flags set on_off = true, updated_at = now() where key = 'student_signups_open';
-- (or the owner's switch in the portal's Settings).
create table if not exists public.app_flags (
  key text primary key, on_off boolean not null, note text, updated_by uuid, updated_at timestamptz not null default now());
alter table public.app_flags enable row level security;
create policy app_flags_read on public.app_flags for select to anon, authenticated using (true);
create policy app_flags_owner_write on public.app_flags for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));
revoke all on public.app_flags from anon, authenticated;
grant select on public.app_flags to anon, authenticated;
grant update (on_off, note, updated_by, updated_at) on public.app_flags to authenticated;
insert into public.app_flags(key, on_off, note) values ('student_signups_open', false, 'Paused 4 Oct 2026 while the admission gate is built')
on conflict (key) do update set on_off = false, note = excluded.note, updated_at = now();

-- handle_new_user(): after the team-invite and approved-partner lookups, a new
-- account that would become a STUDENT is refused while the switch is off:
--   if inv.id is null and pt.id is null
--      and not coalesce((select on_off from public.app_flags where key = 'student_signups_open'), true) then
--     raise exception 'STUDENT_SIGNUPS_PAUSED: new student accounts are paused for now' using errcode = 'P0001';
--   end if;
-- (applied live with the rest of the function unchanged)
