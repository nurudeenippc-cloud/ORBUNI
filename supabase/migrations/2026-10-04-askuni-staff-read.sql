-- Applied to the live project on 2026-10-03. Kept here as the record; already applied, do not run twice.
-- The Orbuni team can read the AskUni bot's applications, commissions and events (portal: Students → AskUni pipeline).
create policy askuni_apps_staff_read on public.askuni_applications for select to authenticated using (public.is_staff());
create policy askuni_comm_staff_read on public.askuni_commissions for select to authenticated using (public.is_staff());
create policy askuni_events_staff_read on public.askuni_events for select to authenticated using (public.is_staff());
