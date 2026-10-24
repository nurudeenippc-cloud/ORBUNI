-- Logged-out visitors could not read whop_config at all ("permission denied for function staff_can"):
-- the owner's FOR ALL policy also applies to SELECT, and its subquery on profiles pulled in profiles' own
-- policies, which call staff_can(), which anon may not execute. Result: no Whop plan, no videos, no group links
-- on any public page, so the VIP checkout showed the student-portal fallback. The owner policy now applies only
-- to signed-in users; the public read policy (is_public OR is_staff()) is unchanged.
alter policy "owner edits whop config" on public.whop_config to authenticated;
-- (checked: anon select count(*) from whop_config now returns the public rows)
