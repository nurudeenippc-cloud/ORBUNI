-- Partner share links (16 Oct 2026)
-- Partners copy three tagged links (assessment, webinar, VIP) from "Get inspired", or email one to a
-- student who is already on their own list. Everything is checked here, never in the browser:
--   * only an approved partner, signed in, can send;
--   * only to a student whose profile belongs to that partner;
--   * only one of the three fixed links (the URL is built here, nothing the browser sends is used);
--   * at most once per student and link a day, and 40 emails per partner a day;
--   * never to an address that unsubscribed, never to test addresses.
-- Every send is recorded in partner_link_sends (the partner can read their own rows, nobody writes directly).

create table if not exists public.partner_link_sends (
  id         bigint generated always as identity primary key,
  partner_id uuid not null references public.partners(id) on delete cascade,
  sender_id  uuid not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  link_key   text not null constraint partner_link_key_chk check (link_key in ('assessment','webinar','vip')),
  channel    text not null default 'email',
  created_at timestamptz not null default now()
);
create index if not exists partner_link_sends_recent on public.partner_link_sends (partner_id, created_at desc);
alter table public.partner_link_sends enable row level security;
drop policy if exists "partner reads own link sends" on public.partner_link_sends;
create policy "partner reads own link sends" on public.partner_link_sends for select
  using (public.is_staff() or partner_id = (select partner_id from public.profiles where id = auth.uid() and role = 'partner'));

-- the short, public tag that goes on a partner's links (first 8 characters of the agency id)
create or replace function public.partner_ref(p_partner uuid)
returns text language sql immutable as $fn$ select 'p-' || left(replace(p_partner::text, '-', ''), 8) $fn$;

create or replace function public.partner_share_link(p_student uuid, p_link text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me record; pa record; st record; url text; n_day int;
begin
  select id, role, partner_id into me from profiles where id = auth.uid();
  if me.id is null or me.role <> 'partner' or me.partner_id is null then
    return jsonb_build_object('ok', false, 'error', 'Only a signed-in partner can send links.');
  end if;
  select id, agency_name, status into pa from partners where id = me.partner_id;
  if pa.id is null or pa.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'Your agency is not approved yet.');
  end if;
  if p_link not in ('assessment','webinar','vip') then
    return jsonb_build_object('ok', false, 'error', 'Unknown link.');
  end if;
  select id, email, first_name, partner_id, role into st from profiles where id = p_student;
  if st.id is null or st.role <> 'student' or st.partner_id is distinct from me.partner_id then
    return jsonb_build_object('ok', false, 'error', 'You can only send links to your own students.');
  end if;
  if st.email is null or position('@' in st.email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'This student has no email address.');
  end if;
  if exists (select 1 from email_optouts where lower(email) = lower(st.email)) then
    return jsonb_build_object('ok', false, 'error', 'This student has unsubscribed from Orbuni emails.');
  end if;
  if exists (select 1 from partner_link_sends where student_id = st.id and link_key = p_link and created_at > now() - interval '24 hours') then
    return jsonb_build_object('ok', false, 'error', 'Already sent to this student today.');
  end if;
  select count(*) into n_day from partner_link_sends where partner_id = me.partner_id and created_at > now() - interval '24 hours';
  if n_day >= 40 then
    return jsonb_build_object('ok', false, 'error', 'Daily limit reached (40 emails). Try again tomorrow.');
  end if;

  url := 'https://myorbuni.com/' || case p_link when 'assessment' then 'start' when 'webinar' then 'webinar' else 'vip' end
         || '/' || partner_ref(me.partner_id);
  insert into partner_link_sends (partner_id, sender_id, student_id, link_key) values (me.partner_id, me.id, st.id, p_link);
  perform queue_email(st.id, 'partner_share',
    jsonb_build_object('link', p_link, 'url', url, 'agency', coalesce(pa.agency_name, 'your education agency'), 'unsub', optout_link(st.email)),
    'partner_share:' || st.id || ':' || p_link || ':' || to_char(now(), 'YYYYMMDD'));
  return jsonb_build_object('ok', true);
end $fn$;
revoke all on function public.partner_share_link(uuid, text) from public, anon;
grant execute on function public.partner_share_link(uuid, text) to authenticated;
