-- 5 Nov 2026: students could read the whole profile row of every staff member and admin,
-- including their personal email, phone and WhatsApp. Students only need a name, photo and
-- job title (counsellor card, feed and chat names, the blue tick).
--   * staff_directory: those safe columns for every staff member and admin, readable by
--     signed-in users. It runs as its owner, so it does not depend on the profiles policies.
--   * the profiles policy that showed staff rows to students now shows them to staff only.
-- Rollback: recreate the policy with my_role() in (student, staff, admin); drop the view.
create or replace view public.staff_directory as
  select id, first_name, last_name, role, job_title, is_owner, photo_path
  from public.profiles
  where role in ('staff', 'admin');
revoke all on public.staff_directory from anon, public;
grant select on public.staff_directory to authenticated;

drop policy if exists "staff are visible to students and staff" on public.profiles;
create policy "staff are visible to staff" on public.profiles for select
  using (role in ('staff'::user_role, 'admin'::user_role) and my_role() in ('staff'::user_role, 'admin'::user_role));
