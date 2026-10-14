-- NOT APPLIED YET — waiting for the owner's OK (it contains DROP CONSTRAINT; no data is touched).
-- Why: the website already sends "quiz_role" (who is filling in the assessment) and now also sends
-- "vsl_half", "video_half" and "video_completed". The check below only allows the old names, so those
-- events are silently rejected. This widens the allowed list. Nothing is deleted.
alter table public.funnel_events drop constraint funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event = any (array[
  'landing_view','vsl_started','vsl_half','vsl_completed','quiz_started','quiz_role','quiz_step','quiz_completed',
  'cta_click','checkout_open','checkout_state','purchase','result_vsl_started','video_half','video_completed',
  'call_booked','community_join']));
