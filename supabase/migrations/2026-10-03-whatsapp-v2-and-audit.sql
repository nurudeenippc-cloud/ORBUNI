-- Applied to the live project on 2026-10-03 (after 2026-10-03-whatsapp.sql).
-- Kept here as the record; already applied, do not run twice.

-- ---------------------------------------------------------------- whatsapp_alert_kinds
alter type public.notif_kind add value if not exists 'whatsapp_handoff';
alter type public.notif_kind add value if not exists 'team_alert';

-- ---------------------------------------------------------------- whatsapp_inbox_v2
-- Inbox v2: labels, "handled" marker, saved replies, media storage, team alerts.
alter table public.wa_contacts add column if not exists labels text[] not null default '{}';
alter table public.wa_contacts add column if not exists resolved_at timestamptz;   -- when a person pressed "Done"
alter table public.wa_contacts add column if not exists held_ack_at timestamptz;   -- last "the team will reply" note while handed over

create table if not exists public.wa_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  sort smallint not null default 100,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.wa_quick_replies enable row level security;
create policy wa_qr_staff_all on public.wa_quick_replies for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.wa_quick_replies (title, body, sort) values
 ('Start the assessment', 'The quickest way to start is our free 2-minute assessment: https://myorbuni.com/#start — it matches you to programmes and shows the real fees and scholarships.', 10),
 ('Upload in the portal', 'Please upload it in your portal under Documents (https://myorbuni.com). Files sent on WhatsApp are not saved to your application.', 20),
 ('Packages', 'Our service packages: Standard $800, Plus $1,650 (adds visa help and airport pickup) and Premier $2,650 (adds a visa agent in your country and arrival support). Tuition is always paid directly to the university.', 30),
 ('Book a call', 'Happy to talk it through on a short call. Send me two times that suit you (and your time zone) and we will set it up.', 40),
 ('We are checking', 'Thanks — we are checking this now and will come back to you here shortly.', 50),
 ('Never pay a person', 'Please note: Orbuni never asks for money on WhatsApp. Payments are only made through the secure checkout on myorbuni.com, and tuition is paid directly to the university.', 60)
on conflict do nothing;

-- WhatsApp files (photos/documents students send, and files the team sends). Private.
insert into storage.buckets (id, name, public) values ('wa-media', 'wa-media', false) on conflict (id) do nothing;
create policy wa_media_staff_read on storage.objects for select to authenticated using (bucket_id = 'wa-media' and public.is_staff());
create policy wa_media_staff_upload on storage.objects for insert to authenticated with check (bucket_id = 'wa-media' and public.is_staff() and (storage.foldername(name))[1] = 'out');

-- A WhatsApp chat needs a person: tell every team member (portal bell + push + email via send-alerts).
create or replace function public.wa_notify_team(p_contact uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  insert into notifications (kind, title, body, entity_type, entity_id, payload)
  values ('whatsapp_handoff', p_title, p_body, 'wa_chat', p_contact, jsonb_build_object('critical', true))
  returning id into v_id;
  insert into notification_recipients (notification_id, profile_id)
  select v_id, pr.id from profiles pr
   where pr.role in ('staff','admin') and not public.is_test_email(pr.email)
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.wa_notify_team(uuid, text, text) from public, anon, authenticated;

-- "Message the team": any team member can alert the others (or chosen people).
create or replace function public.team_alert(p_title text, p_body text default null, p_critical boolean default false, p_to uuid[] default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_from text; n integer;
begin
  if not public.is_staff() then raise exception 'Only the Orbuni team can send team alerts.'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Write what the alert is about.'; end if;
  select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into v_from from profiles where id = auth.uid();
  insert into notifications (kind, title, body, entity_type, payload)
  values ('team_alert', (case when p_critical then 'URGENT: ' else '' end) || left(trim(p_title), 140),
          left(coalesce(p_body, ''), 1000) || case when v_from <> '' then E'\n— ' || v_from else '' end,
          'team', jsonb_build_object('critical', p_critical, 'from', auth.uid()))
  returning id into v_id;
  insert into notification_recipients (notification_id, profile_id)
  select v_id, pr.id from profiles pr
   where pr.role in ('staff','admin') and pr.id <> auth.uid() and not public.is_test_email(pr.email)
     and (p_to is null or pr.id = any(p_to))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.team_alert(text, text, boolean, uuid[]) from public, anon;
grant execute on function public.team_alert(text, text, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------- realtime_feed_and_finance
-- Feed counts (views, likes, comments) and the finance dashboard update live.
-- Realtime respects each table's row-level security, so people only receive rows they may read.
alter publication supabase_realtime add table public.feed_posts;
alter publication supabase_realtime add table public.finance_transactions;

-- ---------------------------------------------------------------- chase_overdue_leads
-- Leads whose "next action" time has passed now raise a lead_overdue alert
-- (bell + phone push + email via send-alerts). The kind existed but nothing raised it.
-- Each lead alerts at most once a day; with more than 5 overdue, one summary instead.
create or replace function public.chase_overdue_leads()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record; v_id uuid; n int := 0; v_total int;
begin
  select count(*) into v_total from leads
   where stage in ('new','mql','working','opportunity')
     and next_action_at < now() - interval '1 hour'
     and not public.is_test_email(email);
  if v_total = 0 then return 0; end if;

  if v_total > 5 then
    if exists (select 1 from notifications where kind = 'lead_overdue' and entity_id is null
                and created_at > now() - interval '20 hours') then return 0; end if;
    v_id := public.raise_notification('lead_overdue',
      v_total || ' leads are waiting for a follow-up',
      'These people asked about studying with Orbuni and the time to contact them has passed. Open Leads and work the list from the top.',
      null, 'lead', null, jsonb_build_object('count', v_total));
    return 1;
  end if;

  for r in
    select l.* from leads l
     where l.stage in ('new','mql','working','opportunity')
       and l.next_action_at < now() - interval '1 hour'
       and not public.is_test_email(l.email)
       and not exists (select 1 from notifications x where x.kind = 'lead_overdue' and x.entity_id = l.id
                        and x.created_at > now() - interval '20 hours')
  loop
    v_id := public.raise_notification('lead_overdue',
      'Follow up: ' || coalesce(nullif(r.name,''), 'a new lead'),
      coalesce(nullif(r.name,''), 'This lead') || ' (band ' || coalesce(r.band,'?') || ', score ' || coalesce(r.score::text,'?') || ') was due a follow-up '
        || case when now() - r.next_action_at > interval '48 hours' then round(extract(epoch from now() - r.next_action_at) / 86400) || ' days ago'
                else round(extract(epoch from now() - r.next_action_at) / 3600) || ' hours ago' end
        || coalesce('. Interested in: ' || nullif(r.programme_interest,''), '') || '. Open Leads to call, WhatsApp or email them.',
      r.student_id, 'lead', r.id, jsonb_build_object('band', r.band, 'score', r.score));
    -- the person the lead is assigned to always hears about it too
    if v_id is not null and r.owner_id is not null then
      insert into notification_recipients (notification_id, profile_id) values (v_id, r.owner_id) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.chase_overdue_leads() from public, anon, authenticated;

-- hourly in working hours (Istanbul 09:00–20:00)
select cron.schedule('orb-chase-leads', '25 6-17 * * *', $$ select public.chase_overdue_leads(); $$);
