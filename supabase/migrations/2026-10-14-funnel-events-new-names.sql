-- 14 Oct 2026 · Applied with the owner's OK (migration funnel_events_new_names). No data touched.
-- Why: the website sends "quiz_role" and now "vsl_half", "video_half", "video_completed"; the old check
-- only allowed the earlier names, so those events were silently rejected. This widens the list.
alter table public.funnel_events drop constraint funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event = any (array[
  'landing_view','vsl_started','vsl_half','vsl_completed','quiz_started','quiz_role','quiz_step','quiz_completed',
  'cta_click','checkout_open','checkout_state','purchase','result_vsl_started','video_half','video_completed',
  'call_booked','community_join']));
